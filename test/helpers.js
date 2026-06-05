// Shared test utilities. Zero-dependency, like the rest of the repo — built on
// node:test + node:assert/strict. Each test file imports only what it needs.
//
// The Node test runner isolates every *file* in its own process, so mutating
// shared module state (e.g. the live theme palette `C`) in one file never leaks
// into another. Within a file, restore anything global you touch.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway temp dir for filesystem tests (ledger, forest). Always pair with
// `t.after(box.cleanup)` (or an afterEach) so nothing leaks into the real repo.
export function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "tb-test-"));
  return {
    dir,
    file: (name) => join(dir, name),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// A complete usage object (every counter present, all numbers). Override any.
export const usage = (o = {}) => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, ...o,
});

// A backend Result — `ok` by default, with a fully-formed usage block. Override
// anything; `usage` is always normalized to a complete object.
export const result = (o = {}) => ({
  ok: true, durationMs: 10, text: "ok", costUsd: 0, estimated: false,
  ...o,
  usage: usage(o.usage),
});

// A frozen Config stand-in with safe, cheap, offline defaults (mock backend,
// tiny retry waits). Override per test. Mirrors the shape lib/core/config.js freezes.
export const config = (o = {}) => Object.freeze({
  backend: "mock", mode: "rich", model: "claude-opus-4-8",
  count: 4, concurrency: 2, timeoutMs: 1000,
  retry: true, retryBaseMs: 10, retryCapMs: 50,
  plain: true, animate: false, dry: true, share: "", assumeYes: true,
  csvPath: "burns.csv", jsonlPath: "ashes.jsonl", forest: false,
  ...o,
});

// A deterministic in-memory backend for fleet/metrics tests: a queue of Results
// (or a function (prompt, calls) => Result) with zero spawning and zero spend.
export function fakeBackend(plan) {
  let calls = 0;
  const next = typeof plan === "function" ? plan : (() => plan[Math.min(calls, plan.length - 1)]);
  return {
    name: "fake", label: "Fake", cmd: "fake",
    available: async () => true,
    async run(prompt) {
      const r = next(prompt, calls);
      calls++;
      return result(r);
    },
    get calls() { return calls; },
  };
}

// Run an async fn with a temporarily-stubbed global, restoring it afterward.
// Handy for Math.random / Date.now determinism without a mocking library.
export async function withStub(obj, key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(obj, key);
  const prev = obj[key];
  obj[key] = value;
  try { return await fn(); }
  finally { if (had) obj[key] = prev; else delete obj[key]; }
}
