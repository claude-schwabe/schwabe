// The orchestrator. Runs work through `backend` with a bounded worker pool and
// emits events so any renderer can subscribe. It holds no UI and no I/O of its
// own — pure coordination.
//
// Two shapes of run:
//   • finite  — pass `tasks` (an array); the pool drains it and run() resolves.
//   • endless — pass `makeTask` (a factory) + `total: Infinity`; the pool keeps
//     pulling fresh tasks forever, refilling every slot, until stop() is called.
// In the endless case `agents` is a bounded window of the most recent agents
// (cumulative counts live in `completed`/`ok`/`errors`), so memory stays flat
// no matter how long it burns.
//
// Events:
//   "start"            { total }
//   "agent:start"      agent
//   "agent:progress"   { agent, est }   live in-flight token estimate while running
//   "agent:wait"       { agent, waitMs, attempt }
//   "agent:retry"      { agent, attempt }
//   "agent:done"       { agent, result }
//   "stopping"         (graceful stop requested)
//   "done"             { agents }

import { EventEmitter } from "node:events";
import { classify, nextWaitMs } from "./retry.js";
import { totalTokens } from "../backends/base.js";

// How much of a finished agent's output we keep in RAM. The full masterpiece is
// already persisted to ashes.jsonl by the ledger during the synchronous
// `agent:done` emit; afterwards only a short preview is ever read (the receipt
// shows ≤90 chars, brag ≤60). Trimming to this keeps a long finite run — and the
// endless window — from hoarding every agent's full text in memory.
const PREVIEW_CHARS = 200;

export class Fleet extends EventEmitter {
  constructor({ backend, cfg, tasks, makeTask = null, total = null }) {
    super();
    this.backend = backend;
    this.cfg = cfg;
    this.makeTask = makeTask;
    if (Array.isArray(tasks)) {
      // Finite run: every agent exists up front (and stays in `agents`).
      this.agents = tasks.map((t) => ({ ...t, status: "queued", tokens: 0, streamTokens: 0, result: null }));
      this.total = tasks.length;
    } else {
      // Endless run: agents are minted lazily by makeTask and windowed.
      this.agents = [];
      this.total = total == null ? Infinity : total;
    }
    this.infinite = !Number.isFinite(this.total);
    this.windowSize = Math.max(50, cfg.window || 600); // endless: cap retained agents
    // Cumulative tallies — survive windowing, so the receipt/header stay honest.
    this.started = 0;
    this.completed = 0;
    this.ok = 0;
    this.errors = 0;
    this.startedAt = 0;
    this.finishedAt = 0;
    this._next = 0;
    this._seq = 0;          // completion order (most-recent-first display)
    this._stop = false;
    this._waiters = [];     // pending retry sleeps, so stop() can cut them short
  }

  get done() { return this.agents.filter((a) => a.status === "done" || a.status === "error").length; }
  get running() { return this.agents.filter((a) => a.status === "running"); }
  get waiting() { return this.agents.filter((a) => a.status === "waiting"); }
  get stopping() { return this._stop; }
  // Sum of the live in-flight estimates of the currently-running agents — added
  // to the booked total so the headline counter ticks up mid-generation.
  get streamingTokens() { return this.running.reduce((s, a) => s + (a.streamTokens || 0), 0); }

  // Ask the fleet to wind down: stop claiming new work, wake any retry-sleeps so
  // their agents finish promptly, and let in-flight calls drain. run() resolves
  // once every worker has returned.
  stop() {
    if (this._stop) return;
    this._stop = true;
    const pending = this._waiters.splice(0);
    for (const w of pending) w();
    this.emit("stopping");
  }

  // A sleep that resolves on timeout OR when stop() fires, and removes itself from
  // the waiter list either way (so the list never grows over an endless run).
  // If stop() already fired (e.g. from the agent:wait listener, before this sleep
  // was even registered), don't sleep at all — wind down immediately.
  _wait(ms) {
    return new Promise((resolve) => {
      if (this._stop) return resolve();
      const entry = () => {
        clearTimeout(timer);
        const i = this._waiters.indexOf(entry);
        if (i >= 0) this._waiters.splice(i, 1);
        resolve();
      };
      const timer = setTimeout(entry, ms);
      this._waiters.push(entry);
    });
  }

  // Endless mode: keep every live agent plus the most-recent finished ones, drop
  // the older finished. Trims in bulk (down to ~60% of the window) so it isn't
  // re-running on every single completion once at capacity.
  _retire() {
    if (this.agents.length <= this.windowSize) return;
    const live = [], finished = [];
    for (const a of this.agents) {
      (a.status === "running" || a.status === "waiting" || a.status === "queued" ? live : finished).push(a);
    }
    finished.sort((a, b) => (a._seq || 0) - (b._seq || 0));
    const keep = Math.max(0, Math.floor(this.windowSize * 0.6));
    this.agents = [...finished.slice(-keep), ...live];
  }

  async run() {
    this.startedAt = this.startedAt || Date.now();   // may be set earlier (e.g. director phase)
    this.emit("start", { total: this.total });

    const worker = async () => {
      while (!this._stop) {
        const i = this._next++;
        if (i >= this.total) break;
        const agent = this.makeTask
          ? this._track({ ...this.makeTask(i), status: "queued", tokens: 0, streamTokens: 0, result: null })
          : this.agents[i];
        this.started++;
        this.emit("agent:start", agent);
        // Burn this agent, retrying through rate/budget limits until it lands.
        for (let attempt = 0; ; ) {
          agent.status = "running";
          agent.streamTokens = 0;
          const result = await this.backend.run(agent.prompt, this.cfg, (est) => {
            agent.streamTokens = est;
            this.emit("agent:progress", { agent, est });
          });
          if (result.ok) { this._finish(agent, result, "done"); break; }
          const cls = classify(result);
          // A normal error, --no-retry, or a fleet that's winding down → give up on this one.
          if (!this.cfg.retry || !cls.retryable || this._stop) { this._finish(agent, result, "error"); break; }
          // out of budget — wait it out and keep trying.
          attempt++;
          const waitMs = nextWaitMs(attempt, cls, this.cfg);
          agent.status = "waiting";
          agent.streamTokens = 0;
          agent.retry = { attempt, until: Date.now() + waitMs, reason: cls.reason, error: result.error };
          this.emit("agent:wait", { agent, waitMs, attempt });
          await this._wait(waitMs);
          this.emit("agent:retry", { agent, attempt });
        }
        if (this.makeTask) this._retire();
      }
    };

    const pool = Array.from({ length: Math.max(1, this.cfg.concurrency) }, () => worker());
    await Promise.all(pool);

    this.finishedAt = Date.now();
    this.emit("done", { agents: this.agents });
  }

  // Push a freshly-minted agent into the live window (endless mode) and return it.
  _track(agent) { this.agents.push(agent); return agent; }

  // Settle an agent terminally: record its result + tokens, clear retry/stream
  // state, stamp its completion order, bump the cumulative tallies, and announce it.
  _finish(agent, result, status) {
    agent.result = result;
    agent.tokens = totalTokens(result.usage);
    agent.streamTokens = 0;
    agent.status = status;
    agent.retry = null;
    agent._seq = ++this._seq;
    this.completed++;
    if (status === "done") this.ok++; else this.errors++;
    this.emit("agent:done", { agent, result });
    // Every full-text consumer (ledger transcript, forest parse) ran synchronously
    // in the emit above — keep only a preview so retained memory doesn't grow with
    // total output. The complete text already lives in ashes.jsonl.
    this._compact(result);
  }

  // Shed the heavy fields a settled result no longer needs: clip the text to a
  // preview and drop the failure `raw` blob. Mutates in place; safe because the
  // emit's listeners have already consumed (and persisted) the full values.
  _compact(result) {
    if (result.text && result.text.length > PREVIEW_CHARS) result.text = result.text.slice(0, PREVIEW_CHARS);
    if (result.raw) result.raw = "";
  }
}
