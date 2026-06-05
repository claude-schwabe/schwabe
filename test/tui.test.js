// Unit tests for lib/ui/tui.js — the btop-style live dashboard's TuiRenderer.
// We test ONLY the pure builders: frame(), row(a, width), and forestPreview(n).
// start()/render()/stop() flip the terminal into the alternate screen / raw mode
// and are deliberately never called here. Agent states are set by hand (the Fleet
// is constructed but never run, so no backend is ever invoked — zero spend). In
// the test process process.stdout.columns/rows are undefined, so frame() falls
// back to its ~100×31 default. Colored output is asserted on the stripped form.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeBackend, config, result, tmp } from "./helpers.js";
import { stripAnsi, visLen } from "../lib/core/util.js";
import { Fleet } from "../lib/engine/fleet.js";
import { Metrics } from "../lib/engine/metrics.js";
import { Forest } from "../lib/forest/index.js";
import { TuiRenderer, miniTree } from "../lib/ui/tui.js";

// A handful of tasks with labels (row() prints a.label for running/done agents).
const tasks = (n) => Array.from({ length: n }, (_, i) => ({ id: i, prompt: `p${i}`, label: `task ${i}` }));

// Build a Fleet (never run) and pose its agents in a representative mix of
// states. startedAt is a real-ish number so frame()'s elapsed stays finite.
function poseFleet() {
  const fleet = new Fleet({ backend: fakeBackend([result()]), cfg: config(), tasks: tasks(5) });
  fleet.startedAt = Date.now() - 5000;
  fleet.agents[0].status = "running";
  fleet.agents[1].status = "done"; fleet.agents[1].tokens = 1234;
  fleet.agents[2].status = "error"; fleet.agents[2].result = { error: "boom" };
  fleet.agents[3].status = "waiting";
  fleet.agents[3].retry = { attempt: 1, until: Date.now() + 30000, reason: "rate / budget limit" };
  // agent[4] stays queued
  return fleet;
}

// A Metrics with a couple of add()s + a tick() so tokens/totals are non-trivial.
function poseMetrics() {
  const m = new Metrics({ tokens: 5000, cost: 0.5, rows: 3 });
  m.add(result({ usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 50, cacheCreationTokens: 10 }, costUsd: 0.01 }));
  m.add(result({ ok: false, usage: { inputTokens: 10, outputTokens: 0 }, costUsd: 0 }));
  m.tick(1000);
  m.tick(2000);
  return m;
}

const newRenderer = (forest = null) =>
  new TuiRenderer(poseFleet(), poseMetrics(), config(), () => {}, forest);

// ── frame(): shape + width discipline + key panels ─────────────────────────
test("frame() returns a non-empty array of strings", () => {
  const lines = newRenderer().frame();
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.equal(typeof l, "string", "every frame line is a string");
});

test("frame() fits every line to the frame width (visLen never exceeds W)", () => {
  // columns/rows are undefined under the test runner → W falls back to 100.
  assert.equal(process.stdout.columns, undefined, "no TTY columns in the test process");
  const W = Math.min(process.stdout.columns || 100, 120);
  const lines = newRenderer().frame();
  for (const l of lines) assert.ok(visLen(l) <= W, `line within ${W} cols: ${visLen(l)}`);
});

test("frame() pads to the fallback frame height (~31 rows)", () => {
  const H = (process.stdout.rows || 32) - 1;
  const lines = newRenderer().frame();
  assert.equal(lines.length, H, "exactly H rows, blank-padded as needed");
});

test("frame() (forest=null) renders the burner header and the core panels", () => {
  const text = stripAnsi(newRenderer().frame().join("\n"));
  assert.ok(text.includes("TOKEN BURNER"), "the title is present");
  assert.ok(text.includes("live incinerator"), "the non-forest header subtitle");
  assert.ok(text.includes("FLEET"), "the FLEET panel");
  assert.ok(text.includes("LEDGER"), "the LEDGER panel");
  assert.ok(text.includes("tokens"), "the token total is labelled");
});

test("frame() surfaces the running/done counts and the per-status agent rows", () => {
  const text = stripAnsi(newRenderer().frame().join("\n"));
  // fleet.done counts terminal agents (done + error): 1 done + 1 error of 5.
  assert.ok(text.includes("2/5 done"), "done/total from the posed fleet");
  assert.ok(text.includes("agent-0"), "the running agent row");
  assert.ok(text.includes("✓ done"), "the done agent's state");
  assert.ok(text.includes("✗ err"), "the errored agent's state");
});

test("frame() shows the rate-limited banner when an agent is waiting", () => {
  const text = stripAnsi(newRenderer().frame().join("\n"));
  assert.ok(text.includes("RATE-LIMITED"), "the waiting banner appears");
  assert.ok(/auto-resuming in ~\d+s/.test(text), "a countdown is shown");
  assert.ok(text.includes("1 agent waiting"), "singular agent count");
});

test("frame() works with a Forest and switches to the reforestation header", () => {
  const box = tmp();
  try {
    const fo = new Forest({ txtPath: box.file("FOREST.txt"), dataPath: box.file("forest.jsonl") });
    fo.plan(4);
    fo.plant(0, Array.from({ length: 14 }, () => "x".repeat(24)), "oak", 100);
    fo.plant(1, Array.from({ length: 14 }, () => "y".repeat(24)), "pine", 200);
    const lines = new TuiRenderer(poseFleet(), poseMetrics(), config(), () => {}, fo).frame();
    const W = Math.min(process.stdout.columns || 100, 120);
    for (const l of lines) assert.ok(visLen(l) <= W, "forest frame stays within width");
    const text = stripAnsi(lines.join("\n"));
    assert.ok(text.includes("TOKEN BURNER"), "the title is still present");
    assert.ok(text.includes("carbon-offset forest"), "the forest header subtitle");
    assert.ok(text.includes("FOREST"), "the FOREST panel");
    assert.ok(text.includes("2 this run"), "the planted-this-run stat");
  } finally {
    box.cleanup();
  }
});

// ── row(): one branch per agent status ─────────────────────────────────────
test("row() renders a running agent at the requested visible width", () => {
  const r = newRenderer();
  const a = { id: 7, status: "running", tokens: 0, label: "burning task" };
  const out = r.row(a, 80);
  assert.equal(visLen(out), 80, "fit to the exact column width");
  const text = stripAnsi(out);
  assert.ok(text.includes("agent-7"), "the agent id");
  assert.ok(text.includes("burn"), "the running state label");
});

test("row() renders a waiting (rate-limited) agent with a retry countdown", () => {
  const r = newRenderer();
  const a = { id: 3, status: "waiting", tokens: 0, retry: { attempt: 2, until: Date.now() + 9000 } };
  const out = r.row(a, 80);
  assert.equal(visLen(out), 80);
  const text = stripAnsi(out);
  assert.ok(text.includes("agent-3"), "the agent id");
  assert.ok(text.includes("rate-limited"), "the waiting label");
  assert.ok(text.includes("retry #2"), "the retry attempt number");
});

test("row() renders a done agent with its token count and state", () => {
  const r = newRenderer();
  const a = { id: 1, status: "done", tokens: 4096, label: "finished task" };
  const out = r.row(a, 80);
  assert.equal(visLen(out), 80);
  const text = stripAnsi(out);
  assert.ok(text.includes("agent-1"), "the agent id");
  assert.ok(text.includes("✓ done"), "the done state");
  assert.ok(text.includes("4,096 tok"), "the grouped token count");
});

test("row() renders an errored agent, surfacing the result error as the label", () => {
  const r = newRenderer();
  const a = { id: 9, status: "error", tokens: 0, result: { error: "overloaded" } };
  const out = r.row(a, 80);
  assert.equal(visLen(out), 80);
  const text = stripAnsi(out);
  assert.ok(text.includes("agent-9"), "the agent id");
  assert.ok(text.includes("✗ err"), "the error state");
  assert.ok(text.includes("overloaded"), "the result error becomes the label");
});

test("row() falls back to a generic 'error' label when no result error", () => {
  const r = newRenderer();
  const out = r.row({ id: 2, status: "error", tokens: 0 }, 60);
  assert.equal(visLen(out), 60);
  assert.ok(stripAnsi(out).includes("error"), "default error label");
});

// ── forestPreview(): the whole forest, zoomed to fit (more trees → more zoom) ──
test("forestPreview() returns the placeholder line when nothing is planted yet", () => {
  const box = tmp();
  try {
    const fo = new Forest({ txtPath: box.file("FOREST.txt"), dataPath: box.file("forest.jsonl") });
    const lines = new TuiRenderer(poseFleet(), poseMetrics(), config(), () => {}, fo).forestPreview(5);
    assert.deepEqual(lines.map(stripAnsi), ["  (planting…)"]);
  } finally {
    box.cleanup();
  }
});

test("forestPreview() returns rendered lines for a forest with planted trees", () => {
  const box = tmp();
  try {
    const fo = new Forest({ txtPath: box.file("FOREST.txt"), dataPath: box.file("forest.jsonl") });
    fo.plan(2);
    fo.plant(0, Array.from({ length: 14 }, (_, i) => `oak${i}`.padEnd(24)), "oak", 100);
    fo.plant(1, Array.from({ length: 14 }, (_, i) => `pine${i}`.padEnd(24)), "pine", 200);
    const r = new TuiRenderer(poseFleet(), poseMetrics(), config(), () => {}, fo);

    const lines = r.forestPreview(99);
    assert.ok(Array.isArray(lines) && lines.length > 0, "returns lines");
    for (const l of lines) assert.equal(typeof l, "string");
    // Only two trees → full detail: both tile side by side, so their raw art shows.
    const joined = stripAnsi(lines.join("\n"));
    assert.ok(joined.includes("oak"), "the planted oak's content is present");
    assert.ok(joined.includes("pine"), "the planted pine's content is present");
  } finally {
    box.cleanup();
  }
});

// A distinctive 24×14 tree: a 'Z' canopy over a '|' trunk, centered.
const markerTree = () => Array.from({ length: 14 }, (_, j) =>
  (j < 7 ? "ZZZZZZZZ".padStart(16) : "||").padStart(13).padEnd(24));

test("miniTree() shrinks the real art (not a substitute) and keeps its ink", () => {
  const t = { lines: markerTree() };
  assert.equal(miniTree(t, 1), t.lines, "f=1 returns the art untouched");
  const half = miniTree(t, 2);
  assert.equal(half.length, 7, "f=2 halves the height (14→7)");
  assert.ok(half.every((l) => l.length === 12), "f=2 halves the width (24→12)");
  assert.ok(half.join("").includes("Z"), "the real canopy ink survives the shrink");
  assert.ok(half.join("").includes("|"), "the real trunk ink survives the shrink");
  const tiny = miniTree(t, 6);
  assert.ok(tiny.length <= 3 && tiny[0].length <= 4, "a big factor makes a tiny tree");
  assert.ok(tiny.join("").includes("Z"), "even tiny, it's still the real tree");
});

test("forestPreview() keeps the real trees but shrinks them as the forest grows", () => {
  const box = tmp();
  const cols = process.stdout.columns;
  try {
    process.stdout.columns = 120;
    const mk = (n) => {
      const fo = new Forest({ txtPath: box.file("FOREST.txt"), dataPath: box.file(`f${n}.jsonl`) });
      for (let i = 0; i < n; i++) fo.plant(i, markerTree(), "oak", 10);
      return new TuiRenderer(poseFleet(), poseMetrics(), config(), () => {}, fo).forestPreview(18);
    };
    const few = stripAnsi(mk(4).join("\n"));
    const manyLines = mk(400);
    const many = stripAnsi(manyLines.join("\n"));
    // The real generated art (its 'Z' canopy) is drawn at every size — never a fake sprite.
    assert.ok(few.includes("Z") && many.includes("Z"), "real tree art is drawn at any zoom");
    // A 400-tree forest still fits the panel — it zoomed out to make room.
    assert.ok(manyLines.length <= 18, "the whole forest fits the panel height");
    // Far more trees are on screen once it's a real forest (shrunk + packed tight).
    const ink = (s) => (s.match(/Z/g) || []).length;
    assert.ok(ink(many) > ink(few) * 3, `a grown forest shows many more trees (few ${ink(few)} → many ${ink(many)})`);
  } finally {
    process.stdout.columns = cols;
    box.cleanup();
  }
});

test("forestPreview() caps the number of returned lines at maxLines (min 1)", () => {
  const box = tmp();
  try {
    const fo = new Forest({ txtPath: box.file("FOREST.txt"), dataPath: box.file("forest.jsonl") });
    fo.plan(1);
    fo.plant(0, Array.from({ length: 14 }, (_, i) => `t${i}`.padEnd(24)), "oak", 50);
    const r = new TuiRenderer(poseFleet(), poseMetrics(), config(), () => {}, fo);
    assert.equal(r.forestPreview(3).length, 3, "honours a small maxLines");
    assert.equal(r.forestPreview(0).length, 1, "never returns fewer than one line");
  } finally {
    box.cleanup();
  }
});
