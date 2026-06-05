// Claude Code backend — the real deal, with real token accounting.
// `claude -p <prompt> --output-format json` returns either a single result
// object or an array of stream events ending in one `{type:"result"}`.
//
// buildArgs/parse are exported as standalone functions so the pure logic
// (rate-limit detection, usage mapping) is unit-testable without spawning the
// real CLI; makeBackend just wires them into a uniform backend.

import { makeBackend } from "./base.js";

export function claudeBuildArgs(prompt, cfg = {}) {
  // --stream switches to streamed NDJSON so the live token count can tick up as
  // the model generates (stream-json print mode requires --verbose). Default is
  // the buffered single-object json — proven, and all figures arrive at the end.
  const format = cfg.stream ? "stream-json" : "json";
  const args = ["-p", prompt, "--output-format", format];
  if (cfg.stream) args.push("--verbose");
  if (cfg.model) args.push("--model", cfg.model);
  return args;
}

export function claudeParse(stdout) {
  // Accept both shapes: a single result object / array (--output-format json) and
  // newline-delimited events (--output-format stream-json).
  let events;
  try {
    const data = JSON.parse(stdout);
    events = Array.isArray(data) ? data : [data];
  } catch {
    events = stdout.split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  if (!events.length) throw new Error("no parseable result");
  const res = events.find((e) => e && e.type === "result") || events[events.length - 1];

  // Budget/rate trouble can arrive as is_error, an api_error_status, or a
  // rate_limit_event whose status isn't "allowed". Surface it as a retryable
  // failure with the reset time so the fleet can wait it out.
  const rl = events.map((e) => e && e.type === "rate_limit_event" && e.rate_limit_info).filter(Boolean).pop();
  const blocked = rl && !/allowed/i.test(rl.status || "");
  if (res.is_error || blocked) {
    const raw = JSON.stringify({ subtype: res.subtype, api_error_status: res.api_error_status, rate_limit: rl, result: res.result });
    return { ok: false, error: res.api_error_status || res.result || rl?.status || "api error", raw, resetAt: rl?.resetsAt };
  }

  const u = res.usage || {};
  return {
    text: res.result ?? res.text ?? "",
    costUsd: res.total_cost_usd ?? 0,
    usage: {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheCreationTokens: u.cache_creation_input_tokens || 0,
    },
    estimated: false,
  };
}

export const claude = makeBackend({
  name: "claude",
  label: "Claude Code",
  cmd: "claude",
  metered: true, // reports real token usage + cost
  buildArgs: claudeBuildArgs,
  parse: claudeParse,
});
