// Backend factory + shared plumbing. A provider is just a spec:
//   { name, label, cmd, buildArgs(prompt,cfg), parse(stdout) -> Partial<Result> }
// makeBackend() wraps it with spawning, timing, availability and error handling
// so every provider behaves identically. Add a provider = write one spec.

import { spawn, execFile } from "node:child_process";
import { now } from "../core/util.js";

/**
 * Per-call token accounting. Every Result carries a complete Usage — makeBackend
 * normalizes the partial usage a spec may return up to all four counters.
 * @typedef {Object} Usage
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheCreationTokens
 */

/**
 * The uniform result of one backend run. On failure `ok` is false and `error`
 * is set; for a rate/budget limit `resetAt` (unix seconds) lets the fleet wait.
 * @typedef {Object} Result
 * @property {boolean} ok
 * @property {string} text
 * @property {Usage} usage
 * @property {number} costUsd
 * @property {number} durationMs
 * @property {boolean} estimated
 * @property {string} [error]
 * @property {string} [raw]
 * @property {number} [resetAt]
 */

/**
 * A provider spec — the entire contract for adding a burn engine. Drop one file
 * in lib/backends/ exporting this shape, register it, and nothing else changes.
 * @typedef {Object} BackendSpec
 * @property {string} name   registry key (lowercased on lookup)
 * @property {string} label  human label for the receipt
 * @property {string} cmd    the CLI binary to spawn
 * @property {boolean} [metered]  true = reports real token/cost, not estimated
 * @property {(prompt: string, cfg: object) => string[]} buildArgs  argv for the CLI
 * @property {(stdout: string) => Partial<Result>} parse  stdout → result fields
 */

/** @returns {Usage} a fresh all-zero usage block */
export const emptyUsage = () => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
});

export const totalTokens = (u) =>
  (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheCreationTokens || 0);

// rough fallback when a provider gives no usage numbers
export const estimateTokens = (s) => Math.ceil((s || "").length / 4);

export function which(cmd) {
  return new Promise((resolve) => {
    execFile("which", [cmd], (err, stdout) => resolve(!err && !!stdout.trim()));
  });
}

function spawnCollect(cmd, args, { timeoutMs, onChunk }) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { if (!done) { done = true; child.kill("SIGKILL"); resolve({ code: -1, stdout, stderr: stderr + "\n[timeout]" }); } }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; if (onChunk) onChunk(stdout); }); // onChunk: live progress as output streams in
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e) }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } });
  });
}

/**
 * Wrap a {@link BackendSpec} into a uniform backend: spawn the CLI, time it,
 * normalize usage, and surface failures (including spec-reported api errors).
 * @param {BackendSpec} spec
 * @returns {{ name: string, label: string, cmd: string, metered: boolean,
 *   available: () => Promise<boolean>,
 *   run: (prompt: string, cfg: object, onProgress?: (estTokens: number) => void) => Promise<Result> }}
 */
export function makeBackend(spec) {
  return {
    name: spec.name,
    label: spec.label,
    cmd: spec.cmd,
    metered: !!spec.metered, // true = reports real token/cost accounting (not estimated)
    available: () => which(spec.cmd),
    // onProgress (optional) ticks a live in-flight token estimate as output streams.
    // Only fires mid-run when the CLI actually streams (cfg.stream → stream-json);
    // otherwise it fires once at the end and the real usage takes over immediately.
    async run(prompt, cfg, onProgress) {
      const t0 = now();
      const onChunk = (onProgress && cfg.stream) ? (out) => onProgress(estimateTokens(out)) : undefined;
      const { code, stdout, stderr } = await spawnCollect(spec.cmd, spec.buildArgs(prompt, cfg), { timeoutMs: cfg.timeoutMs, onChunk });
      const durationMs = now() - t0;
      const fail = (extra) => ({ ok: false, durationMs, text: "", costUsd: 0, estimated: false, usage: emptyUsage(), ...extra });
      if (!stdout.trim()) {
        return fail({ error: (stderr || `exit ${code}`).trim().slice(0, 200), raw: stderr });
      }
      try {
        const r = spec.parse(stdout);
        // A backend can report an API-level failure (e.g. rate/budget) even on a
        // clean exit by returning { ok:false, error, raw, resetAt }.
        if (r.ok === false) return fail({ error: r.error || "api error", raw: r.raw || "", resetAt: r.resetAt });
        return {
          ok: true, durationMs,
          text: r.text || "",
          usage: { ...emptyUsage(), ...r.usage },
          costUsd: r.costUsd || 0,
          estimated: !!r.estimated,
        };
      } catch (e) {
        return fail({ error: `parse: ${String(e).slice(0, 160)}`, raw: stderr });
      }
    },
  };
}
