// Unit tests for lib/engine/fleet.js — the Fleet worker pool. Covers the constructor's
// task→agent mapping, the done/running/waiting getters, and run(): the happy
// path (every agent → "done", tokens summed from usage, the full event stream),
// the retry path (a retryable failure then success → "done" + an "agent:wait"),
// a non-retryable failure (→ "error"), and retry:false (a retryable failure
// ends "error" immediately, no wait). A deterministic in-memory fakeBackend and
// tiny retry waits keep it fast and offline; no real CLI is ever spawned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeBackend, config, result } from "./helpers.js";
import { Fleet } from "../lib/engine/fleet.js";

const tasks = (n) => Array.from({ length: n }, (_, i) => ({ id: i, prompt: `p${i}` }));

// Subscribe to every event run() emits, collecting payloads per channel.
function captureEvents(fleet) {
  const events = { start: [], "agent:start": [], "agent:wait": [], "agent:retry": [], "agent:done": [], done: [] };
  for (const name of Object.keys(events)) fleet.on(name, (e) => events[name].push(e));
  return events;
}

test("constructor maps tasks to queued agents (tokens 0, result null, fields preserved)", () => {
  const fleet = new Fleet({ backend: fakeBackend([result()]), cfg: config(), tasks: tasks(3) });
  assert.equal(fleet.agents.length, 3);
  for (const [i, agent] of fleet.agents.entries()) {
    assert.equal(agent.status, "queued");
    assert.equal(agent.tokens, 0);
    assert.equal(agent.result, null);
    assert.equal(agent.id, i, "original task fields carried over");
    assert.equal(agent.prompt, `p${i}`);
  }
  assert.equal(fleet.startedAt, 0);
  assert.equal(fleet.finishedAt, 0);
});

test("getters count terminal/running/waiting agents by status", () => {
  const fleet = new Fleet({ backend: fakeBackend([result()]), cfg: config(), tasks: tasks(5) });
  fleet.agents[0].status = "done";
  fleet.agents[1].status = "error";
  fleet.agents[2].status = "running";
  fleet.agents[3].status = "waiting";
  // agents[4] stays "queued"
  assert.equal(fleet.done, 2, "done counts both 'done' and 'error'");
  assert.deepEqual(fleet.running.map((a) => a.id), [2]);
  assert.deepEqual(fleet.waiting.map((a) => a.id), [3]);
});

test("run drives every agent to done and sums usage into agent.tokens", async () => {
  const backend = fakeBackend([result({ usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 3, cacheCreationTokens: 2 } })]);
  const fleet = new Fleet({ backend, cfg: config({ count: 4, concurrency: 2 }), tasks: tasks(4) });
  await fleet.run();
  for (const agent of fleet.agents) {
    assert.equal(agent.status, "done");
    assert.equal(agent.tokens, 17, "5+7+3+2");
    assert.equal(agent.result.ok, true);
    assert.equal(agent.retry, null);
  }
  assert.equal(fleet.done, 4);
});

test("run emits start, per-agent start/done, and a final done event", async () => {
  const fleet = new Fleet({ backend: fakeBackend([result()]), cfg: config({ count: 3, concurrency: 1 }), tasks: tasks(3) });
  const events = captureEvents(fleet);
  await fleet.run();

  assert.equal(events.start.length, 1);
  assert.deepEqual(events.start[0], { total: 3 });
  assert.equal(events["agent:start"].length, 3, "one start per agent");
  assert.equal(events["agent:done"].length, 3, "one done per agent");
  assert.equal(events.done.length, 1);
  assert.equal(events.done[0].agents, fleet.agents, "final done carries the agent array");
  // every agent:done payload pairs the agent with its winning result
  for (const { agent, result: r } of events["agent:done"]) {
    assert.equal(r.ok, true);
    assert.equal(agent.status, "done");
  }
});

test("run records startedAt/finishedAt and preserves a pre-set startedAt", async () => {
  const fleet = new Fleet({ backend: fakeBackend([result()]), cfg: config({ count: 1, concurrency: 1 }), tasks: tasks(1) });
  fleet.startedAt = 12345; // e.g. set during a director phase
  await fleet.run();
  assert.equal(fleet.startedAt, 12345, "an earlier startedAt is kept");
  assert.ok(fleet.finishedAt > 0, "finishedAt stamped on completion");
});

test("run with no tasks emits start/done and never touches an agent", async () => {
  const fleet = new Fleet({ backend: fakeBackend([result()]), cfg: config({ count: 0, concurrency: 2 }), tasks: [] });
  const events = captureEvents(fleet);
  await fleet.run();
  assert.deepEqual(events.start[0], { total: 0 });
  assert.equal(events["agent:start"].length, 0);
  assert.equal(events.done.length, 1);
  assert.equal(fleet.done, 0);
});

test("retry path: a retryable failure then success ends done and fires agent:wait", async () => {
  let n = 0;
  // count:1, concurrency:1 → a single deterministic call counter.
  const backend = fakeBackend(() =>
    n++ === 0 ? result({ ok: false, error: "rate limit exceeded" })
              : result({ ok: true, usage: { outputTokens: 4 } }));
  const cfg = config({ count: 1, concurrency: 1, retry: true, retryBaseMs: 5, retryCapMs: 20 });
  const fleet = new Fleet({ backend, cfg, tasks: tasks(1) });
  const events = captureEvents(fleet);
  await fleet.run();

  const agent = fleet.agents[0];
  assert.equal(agent.status, "done", "succeeds after waiting out the limit");
  assert.equal(agent.tokens, 4, "tokens come from the successful attempt");
  assert.equal(agent.retry, null, "retry state cleared on success");
  assert.equal(events["agent:wait"].length, 1, "waited exactly once");
  assert.equal(events["agent:wait"][0].attempt, 1);
  assert.ok(events["agent:wait"][0].waitMs >= 0);
  assert.equal(events["agent:retry"].length, 1, "resumed after the wait");
  assert.equal(events["agent:done"].length, 1, "only the final landing is announced");
  assert.equal(events["agent:done"][0].result.ok, true);
});

test("retry path: agent:wait carries the reason/error in agent.retry mid-flight", async () => {
  let observed = null;
  let n = 0;
  const backend = fakeBackend(() =>
    n++ === 0 ? result({ ok: false, error: "usage limit reached" })
              : result({ ok: true }));
  const cfg = config({ count: 1, concurrency: 1, retry: true, retryBaseMs: 5, retryCapMs: 20 });
  const fleet = new Fleet({ backend, cfg, tasks: tasks(1) });
  fleet.on("agent:wait", ({ agent }) => { observed = { ...agent.retry }; });
  await fleet.run();
  assert.equal(observed.attempt, 1);
  assert.equal(observed.reason, "rate / budget limit");
  assert.equal(observed.error, "usage limit reached");
});

test("non-retryable failure ends error and announces it once", async () => {
  const backend = fakeBackend([result({ ok: false, error: "syntax error" })]);
  const cfg = config({ count: 1, concurrency: 1, retry: true });
  const fleet = new Fleet({ backend, cfg, tasks: tasks(1) });
  const events = captureEvents(fleet);
  await fleet.run();

  const agent = fleet.agents[0];
  assert.equal(agent.status, "error");
  assert.equal(agent.result.ok, false);
  assert.equal(agent.result.error, "syntax error");
  assert.equal(agent.retry, null);
  assert.equal(events["agent:wait"].length, 0, "an ordinary error is never waited on");
  assert.equal(events["agent:done"].length, 1, "the failure is still reported via agent:done");
  assert.equal(events["agent:done"][0].result.ok, false);
  assert.equal(fleet.done, 1, "error counts as a finished agent");
});

test("retry:false short-circuits a retryable failure straight to error (no wait)", async () => {
  const backend = fakeBackend([result({ ok: false, error: "rate limit exceeded" })]);
  const cfg = config({ count: 1, concurrency: 1, retry: false });
  const fleet = new Fleet({ backend, cfg, tasks: tasks(1) });
  const events = captureEvents(fleet);
  await fleet.run();

  assert.equal(fleet.agents[0].status, "error", "no retry → the first failure is fatal");
  assert.equal(events["agent:wait"].length, 0, "never waited");
  assert.equal(events["agent:retry"].length, 0);
  assert.equal(backend.calls, 1, "backend called exactly once");
  assert.equal(events["agent:done"].length, 1);
});

// ── memory: settled results keep only a preview ──────────────────────────────
test("finished agents keep a clipped text preview, not the whole masterpiece", async () => {
  const huge = "x".repeat(5000);
  let full = null;
  const backend = fakeBackend([result({ ok: true, text: huge })]);
  const fleet = new Fleet({ backend, cfg: config({ count: 1, concurrency: 1 }), tasks: tasks(1) });
  // The synchronous agent:done consumer still sees the FULL text (this is when the
  // ledger persists it) — compaction only happens after every listener has run.
  fleet.on("agent:done", ({ result: r }) => { full = r.text; });
  await fleet.run();

  assert.equal(full, huge, "listeners receive the complete output before compaction");
  assert.ok(fleet.agents[0].result.text.length < huge.length, "retained text is trimmed");
  assert.ok(fleet.agents[0].result.text.length <= 200, "retained text is a bounded preview");
  assert.ok(huge.startsWith(fleet.agents[0].result.text), "the preview is a prefix of the original");
});

test("a settled failure drops its raw blob", async () => {
  const backend = fakeBackend([result({ ok: false, error: "boom", raw: "y".repeat(4000) })]);
  const fleet = new Fleet({ backend, cfg: config({ count: 1, concurrency: 1, retry: false }), tasks: tasks(1) });
  await fleet.run();
  assert.equal(fleet.agents[0].result.error, "boom", "the error message is preserved");
  assert.equal(fleet.agents[0].result.raw, "", "the heavy raw blob is shed");
});

// ── cumulative tallies & completion order ────────────────────────────────────
test("run tracks cumulative completed/ok/errors and stamps _seq in finish order", async () => {
  let n = 0;
  // 1st ok, 2nd a non-retryable error, 3rd ok — concurrency 1 → deterministic order.
  const backend = fakeBackend(() => (n++ === 1 ? result({ ok: false, error: "syntax error" }) : result()));
  const fleet = new Fleet({ backend, cfg: config({ count: 3, concurrency: 1 }), tasks: tasks(3) });
  await fleet.run();
  assert.equal(fleet.completed, 3, "every agent counted once");
  assert.equal(fleet.ok, 2);
  assert.equal(fleet.errors, 1);
  assert.deepEqual(fleet.agents.map((a) => a._seq), [1, 2, 3], "completion order stamped 1..n");
});

// ── endless mode (makeTask + total:Infinity) ─────────────────────────────────
test("endless run mints agents lazily, refills slots, and winds down on stop()", async () => {
  const backend = fakeBackend([result({ usage: { outputTokens: 2 } })]);
  const fleet = new Fleet({
    backend, cfg: config({ concurrency: 3, window: 100 }),
    makeTask: (i) => ({ id: i, prompt: `p${i}` }), total: Infinity,
  });
  assert.equal(fleet.infinite, true, "Infinity total → endless");
  assert.equal(fleet.agents.length, 0, "no agents up front — minted on demand");
  fleet.on("agent:done", () => { if (fleet.completed >= 12) fleet.stop(); });
  await fleet.run();
  assert.ok(fleet.completed >= 12, "kept minting and burning past the first batch");
  assert.equal(fleet.ok, fleet.completed, "all succeeded");
  assert.equal(fleet.errors, 0);
  assert.ok(fleet.finishedAt > 0, "settles after stop()");
});

test("endless mode windows the in-memory agent list to ~cfg.window", async () => {
  const backend = fakeBackend([result()]);
  const cfg = config({ concurrency: 2, window: 50 });
  const fleet = new Fleet({ backend, cfg, makeTask: (i) => ({ id: i, prompt: "p" }), total: Infinity });
  fleet.on("agent:done", () => { if (fleet.completed >= 300) fleet.stop(); });
  await fleet.run();
  assert.ok(fleet.completed >= 300, "burned well past the window size");
  assert.ok(fleet.agents.length <= cfg.window, `agents windowed to <= ${cfg.window}, got ${fleet.agents.length}`);
});

test("stop() interrupts an in-flight retry wait so the agent settles promptly", async () => {
  // Always rate-limited → without stop it would retry essentially forever.
  const backend = fakeBackend([result({ ok: false, error: "rate limit exceeded" })]);
  const cfg = config({ concurrency: 1, retry: true, retryBaseMs: 100000, retryCapMs: 100000 });
  const fleet = new Fleet({ backend, cfg, makeTask: (i) => ({ id: i, prompt: "p" }), total: Infinity });
  let waited = false;
  fleet.on("agent:wait", () => { waited = true; fleet.stop(); });
  const t0 = Date.now();
  await fleet.run();
  assert.ok(waited, "it entered a retry wait");
  assert.ok(Date.now() - t0 < 5000, "stop() cut the long wait short rather than sleeping it out");
  assert.equal(fleet.errors, 1, "the rate-limited agent settles as an error once stopping");
});
