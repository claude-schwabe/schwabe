// Unit tests for lib/ui/plain.js — the headless PlainRenderer. We never flip the
// terminal: start() only subscribes to fleet events and console.logs, so we drive
// it by capturing console.log (via withStub) and emitting events on a real Fleet.
// Assertions compare on the ANSI-stripped text so no raw escape codes are baked in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmp, result, config, fakeBackend } from "./helpers.js";
import { stripAnsi } from "../lib/core/util.js";
import { PlainRenderer } from "../lib/ui/plain.js";
import { Fleet } from "../lib/engine/fleet.js";
import { Metrics } from "../lib/engine/metrics.js";
import { Forest } from "../lib/forest/index.js";

// Build a Fleet + Metrics + PlainRenderer wired for plain mode. The backend is a
// fake (never spawns / never spends); we emit events by hand rather than run().
function harness({ cfg = config({ plain: true }), forest = null, tasks } = {}) {
  const fleet = new Fleet({
    backend: fakeBackend([result({ ok: true })]),
    cfg,
    tasks: tasks || [{ id: "001", prompt: "p", label: "doing a thing" }],
  });
  const metrics = new Metrics();
  const renderer = new PlainRenderer(fleet, metrics, cfg, forest);
  return { fleet, metrics, renderer };
}

// Capture every console.log line (ANSI-stripped) produced while `fn` runs.
async function captured(fn) {
  const lines = [];
  await import("./helpers.js").then(({ withStub }) =>
    withStub(console, "log", (...a) => lines.push(stripAnsi(a.join(" "))), fn));
  return lines;
}

test("start() prints a header naming the mode, agent count, backend and model", async () => {
  const cfg = config({ plain: true, mode: "schwabe", backend: "mock", model: "claude-haiku-4-5-20251001", concurrency: 2 });
  const { renderer } = harness({ cfg });
  const lines = await captured(() => renderer.start());
  const header = lines.join("\n");
  assert.match(header, /SCHWABE mode/);
  assert.match(header, /burning 1 agents/, "non-forest header says 'burning'");
  assert.match(header, /via mock/);
  assert.match(header, /haiku-4-5-20251001/, "model label drops the claude- prefix");
  assert.match(header, /2 at a time/);
});

test("agent:done (ok) logs a check mark, the agent id, token count and label", async () => {
  const { fleet, renderer } = harness();
  const lines = await captured(() => {
    renderer.start();
    fleet.emit("agent:done", {
      agent: { id: "001", label: "doing a thing", tokens: 1234, species: "oak" },
      result: result({ ok: true }),
    });
  });
  const line = lines.find((l) => l.includes("agent-001"));
  assert.ok(line, "a line mentions agent-001");
  assert.match(line, /✓/, "ok mark");
  assert.match(line, /1,234 tok/, "grouped token count from agent.tokens");
  assert.match(line, /doing a thing/, "the agent label is shown on success");
});

test("agent:done ticks metrics each time it fires", async () => {
  const { fleet, metrics, renderer } = harness();
  let ticks = 0;
  const realTick = metrics.tick.bind(metrics);
  metrics.tick = (...a) => { ticks++; return realTick(...a); };
  await captured(() => {
    renderer.start();
    fleet.emit("agent:done", { agent: { id: "001", label: "x", tokens: 5 }, result: result({ ok: true }) });
    fleet.emit("agent:done", { agent: { id: "002", label: "y", tokens: 9 }, result: result({ ok: true }) });
  });
  assert.equal(ticks, 2, "one tick per finished agent");
});

test("agent:done (error) logs a cross mark and the error text instead of the label", async () => {
  const { fleet, renderer } = harness();
  const lines = await captured(() => {
    renderer.start();
    fleet.emit("agent:done", {
      agent: { id: "007", label: "should not be shown", tokens: 0 },
      result: result({ ok: false, error: "boom" }),
    });
  });
  const line = lines.find((l) => l.includes("agent-007"));
  assert.ok(line, "a line mentions agent-007");
  assert.match(line, /✗/, "error mark");
  assert.match(line, /boom/, "the error text is surfaced");
  assert.ok(!line.includes("should not be shown"), "the label is suppressed on error");
});

test("agent:done (error) with no error string falls back to the word 'error'", async () => {
  const { fleet, renderer } = harness();
  const lines = await captured(() => {
    renderer.start();
    fleet.emit("agent:done", {
      agent: { id: "009", label: "lbl", tokens: 0 },
      result: result({ ok: false, error: "" }),
    });
  });
  const line = lines.find((l) => l.includes("agent-009"));
  assert.ok(line);
  assert.match(line, /error/, "default error word when none provided");
});

test("agent:done marks estimated results with a ~est tag", async () => {
  const { fleet, renderer } = harness();
  const lines = await captured(() => {
    renderer.start();
    fleet.emit("agent:done", {
      agent: { id: "001", label: "x", tokens: 42 },
      result: result({ ok: true, estimated: true }),
    });
  });
  const line = lines.find((l) => l.includes("agent-001"));
  assert.match(line, /~est/, "estimated results carry the ~est tag");
});

test("agent:wait logs a rate-limited retry line with the attempt and seconds", async () => {
  const { fleet, renderer } = harness();
  const lines = await captured(() => {
    renderer.start();
    fleet.emit("agent:wait", { agent: { id: "002" }, waitMs: 3000, attempt: 1 });
  });
  const line = lines.find((l) => l.includes("agent-002"));
  assert.ok(line, "a line mentions agent-002");
  assert.match(line, /rate-limited/);
  assert.match(line, /retry #1/, "shows the attempt number");
  assert.match(line, /in 3s/, "rounds waitMs up to whole seconds");
});

test("agent:wait rounds a fractional wait up to the next whole second", async () => {
  const { fleet, renderer } = harness();
  const lines = await captured(() => {
    renderer.start();
    fleet.emit("agent:wait", { agent: { id: "003" }, waitMs: 2100, attempt: 4 });
  });
  const line = lines.find((l) => l.includes("agent-003"));
  assert.match(line, /retry #4 in 3s/, "2100ms ceils to 3s");
});

test("forest mode: header says 'planting trees' rather than 'burning'", async () => {
  const box = tmp();
  const forest = new Forest({ txtPath: box.file("FOREST.txt"), dataPath: box.file("forest.jsonl") });
  const { renderer } = harness({ forest });
  const lines = await captured(() => renderer.start());
  box.cleanup();
  const header = lines.join("\n");
  assert.match(header, /planting 1 trees to "offset" the burn/);
  assert.ok(!/ burning 1 agents/.test(header), "the burning phrasing is replaced in forest mode");
});

test("forest mode: an ok agent:done logs a 'planted <species>' tree line with the planted tally", async () => {
  const box = tmp();
  const forest = new Forest({ txtPath: box.file("FOREST.txt"), dataPath: box.file("forest.jsonl") });
  // Plant one tree so forest.planted reports a real count.
  forest.plan(1);
  forest.plant(0, ["x"], "oak", 1234);
  const { fleet, renderer } = harness({ forest });
  const lines = await captured(() => {
    renderer.start();
    fleet.emit("agent:done", {
      agent: { id: "001", label: "doing a thing", tokens: 1234, species: "oak" },
      result: result({ ok: true }),
    });
  });
  box.cleanup();
  const line = lines.find((l) => l.includes("agent-001") && l.includes("planted"));
  assert.ok(line, "a tree line mentions agent-001 and 'planted'");
  assert.match(line, /🌳/, "tree glyph");
  assert.match(line, /planted oak/, "the species is named");
  assert.match(line, /\(1\/1 trees\)/, "shows forest.planted / total tally");
  assert.match(line, /1,234 tok/, "still reports the token count");
  assert.ok(!line.includes("doing a thing"), "forest line omits the burn label");
});

test("forest mode: a failed agent:done falls through to the ordinary error line (no tree)", async () => {
  const box = tmp();
  const forest = new Forest({ txtPath: box.file("FOREST.txt"), dataPath: box.file("forest.jsonl") });
  const { fleet, renderer } = harness({ forest });
  const lines = await captured(() => {
    renderer.start();
    fleet.emit("agent:done", {
      agent: { id: "004", label: "lbl", tokens: 0, species: "pine" },
      result: result({ ok: false, error: "kaboom" }),
    });
  });
  box.cleanup();
  const line = lines.find((l) => l.includes("agent-004"));
  assert.ok(line);
  assert.match(line, /✗/, "error mark, not a tree");
  assert.match(line, /kaboom/);
  assert.ok(!line.includes("planted"), "a failed plant is not reported as planted");
});

test("stop() is a no-op that returns without throwing or logging", async () => {
  const { renderer } = harness();
  const lines = await captured(() => {
    assert.equal(renderer.stop(), undefined);
  });
  assert.equal(lines.length, 0, "stop() prints nothing");
});
