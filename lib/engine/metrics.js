// Live aggregates for the dashboard. Fed one result at a time; tick() turns the
// bursty arrival of finished-agent token totals into a smooth, decaying
// tokens/sec rate plus a rolling history for the btop-style graph. Pure state,
// no I/O.

import { now } from "../core/util.js";

// A finished agent dumps its entire token count in one frame, so the raw
// per-frame rate spikes to thousands then crashes to 0 until the next completion.
// Instead we pour each arrival into a reservoir that bleeds out over ~3·tau
// seconds: a burst becomes a decaying tail toward 0, and two bursts close
// together simply overlap (they add in the reservoir). The released amount per
// second IS the rate, and its integral equals the tokens poured in — so the
// smoothed curve stays honest on average, it just spreads each burst across its
// tail. JITTER adds a little organic wobble so the tail wanders down instead of
// tracing a clean exponential.
const RELEASE_TAU = 1.6; // seconds; a lone burst fades to ~0 over ~5s (≈3·tau)
const JITTER = 0.3;      // ±15% cosmetic wobble on the smoothed rate

export class Metrics {
  constructor(lifetime = { tokens: 0, cost: 0, rows: 0 }, opts = {}) {
    this.lifetime = lifetime; // seeded from the CSV (all previous runs)
    this.totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0, ok: 0, errors: 0 };
    this.history = [];        // tokens/sec samples (for the graph)
    this.rate = 0;            // smoothed tokens/sec
    this.peak = 0;
    this._reservoir = 0;      // unreleased tokens, bled out as the live rate
    this._tau = opts.releaseTau ?? RELEASE_TAU;
    this._jitter = opts.jitter ?? JITTER;     // 0 disables the wobble (tests)
    this._rng = opts.rng ?? Math.random;      // injectable for deterministic tests
    this._last = { t: null, tok: 0 };
  }

  add(result) {
    const u = result.usage;
    this.totals.input += u.inputTokens;
    this.totals.output += u.outputTokens;
    this.totals.cacheRead += u.cacheReadTokens;
    this.totals.cacheCreation += u.cacheCreationTokens;
    this.totals.cost += result.costUsd;
    if (result.ok) this.totals.ok++; else this.totals.errors++;
  }

  get tokens() {
    const t = this.totals;
    return t.input + t.output + t.cacheRead + t.cacheCreation;
  }

  get runCost() { return this.totals.cost; }

  // Lifetime (all prior CSV rows) + this run, so every renderer reads one source
  // of truth instead of re-deriving the sum (and silently disagreeing on it).
  get allTimeTokens() { return this.lifetime.tokens + this.tokens; }
  get allTimeCost() { return this.lifetime.cost + this.runCost; }
  get allTimeBurns() { return this.lifetime.rows + this.totals.ok + this.totals.errors; }

  // Call once per render frame to refresh the rate + graph. Newly-finished tokens
  // are poured into a reservoir that bleeds out over ~tau seconds, so the rate is
  // a smooth decaying tail rather than a spike-then-zero — and bursts close
  // together overlap. Frame-rate independent (the fraction released scales with
  // dt), so it behaves the same at any render interval.
  tick(t = now()) {
    if (this._last.t == null) { this._last = { t, tok: this.tokens }; return; }
    const dt = (t - this._last.t) / 1000;
    if (dt <= 0.05) return; // ignore sub-50ms frames

    // Pour this frame's real arrivals into the reservoir...
    const arrived = this.tokens - this._last.tok;
    if (arrived > 0) this._reservoir += arrived;
    this._last = { t, tok: this.tokens };

    // ...then bleed a time-constant fraction back out as this frame's rate.
    const released = this._reservoir * (1 - Math.exp(-dt / this._tau));
    this._reservoir -= released;
    let rate = released / dt;
    if (rate > 0) rate *= 1 + (this._rng() - 0.5) * this._jitter;

    this.rate = rate > 0 ? rate : 0;
    this.peak = Math.max(this.peak, this.rate);
    this.history.push(this.rate);
    if (this.history.length > 240) this.history.shift();
  }
}
