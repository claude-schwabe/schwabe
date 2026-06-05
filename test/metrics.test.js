// Unit tests for lib/engine/metrics.js — the live dashboard aggregates. Pure state, fed
// one result at a time; tick() derives a tokens/sec rate and a rolling history.

import { test } from "node:test";
import assert from "node:assert/strict";
import { result } from "./helpers.js";
import { Metrics } from "../lib/engine/metrics.js";

test("a fresh Metrics is all zeros", () => {
  const m = new Metrics();
  assert.deepEqual(m.lifetime, { tokens: 0, cost: 0, rows: 0 });
  assert.equal(m.tokens, 0);
  assert.equal(m.runCost, 0);
  assert.equal(m.rate, 0);
  assert.equal(m.peak, 0);
  assert.deepEqual(m.history, []);
});

test("add accumulates usage, cost, and ok/error counts", () => {
  const m = new Metrics();
  m.add(result({ costUsd: 0.25, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 1 } }));
  m.add(result({ ok: false, costUsd: 0 }));
  assert.equal(m.totals.input, 10);
  assert.equal(m.totals.output, 20);
  assert.equal(m.tokens, 36);
  assert.equal(m.runCost, 0.25);
  assert.equal(m.totals.ok, 1);
  assert.equal(m.totals.errors, 1);
});

test("all-time accessors combine lifetime + run, counting every burn (ok + error)", () => {
  const m = new Metrics({ tokens: 100, cost: 1.5, rows: 3 });
  m.add(result({ costUsd: 0.5, usage: { outputTokens: 30 } }));
  m.add(result({ ok: false }));
  assert.equal(m.allTimeTokens, 130);
  assert.equal(m.allTimeCost, 2);
  assert.equal(m.allTimeBurns, 5);
});

test("tick smooths a bursty arrival into a decaying tail, not a spike-then-zero", () => {
  // jitter off + a known tau so the smoothing is deterministic.
  const m = new Metrics(undefined, { jitter: 0, releaseTau: 1 });
  m.tick(0);            // first tick only seeds the baseline
  assert.equal(m.rate, 0);
  m.add(result({ usage: { outputTokens: 2000 } }));
  m.tick(1000);         // 2000 tok land in one frame...
  // ...the raw instantaneous rate would read the full 2000 tok/s; the reservoir
  // releases only a fraction, so the headline never spikes to the whole burst.
  assert.ok(m.rate > 0 && m.rate < 2000, `smoothed below the raw spike (got ${m.rate})`);
  const first = m.rate;
  m.tick(2000);         // no new tokens — the tail keeps bleeding, not 0
  assert.ok(m.rate > 0 && m.rate < first, `tail decays toward 0 (got ${m.rate})`);
  m.tick(3000);
  assert.ok(m.rate < m.history.at(-2), "and keeps decaying frame over frame");
  assert.equal(m.peak, first, "peak captures the smoothed maximum, not the raw spike");
});

test("two bursts close together overlap (they sum in the reservoir)", () => {
  const m = new Metrics(undefined, { jitter: 0, releaseTau: 1 });
  m.tick(0);
  m.add(result({ usage: { outputTokens: 1000 } }));
  m.tick(1000);
  const afterOne = m.rate;
  m.add(result({ usage: { outputTokens: 1000 } }));
  m.tick(2000);         // a second burst lands while the first is still bleeding
  assert.ok(m.rate > afterOne, "the overlapping burst lifts the rate above the lone tail");
});

test("tick ignores frames closer than 50ms apart", () => {
  const m = new Metrics(undefined, { jitter: 0 });
  m.tick(0);
  m.add(result({ usage: { outputTokens: 1000 } }));
  m.tick(1000);
  const rate = m.rate, len = m.history.length;
  m.tick(1010);         // dt = 10ms < 50ms → frame skipped, nothing changes
  assert.equal(m.history.length, len);
  assert.equal(m.rate, rate);
});

test("history is capped at 240 samples", () => {
  const m = new Metrics();
  m.tick(0);
  for (let i = 1; i <= 245; i++) m.tick(i * 100); // 245 spaced samples
  assert.equal(m.history.length, 240);
});
