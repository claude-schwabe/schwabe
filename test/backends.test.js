// Unit tests for the backend layer: base.js plumbing, each provider spec's pure
// buildArgs/parse, the makeBackend() spawn pipeline (driven through a real
// `node -e` child so no external CLI is needed and nothing is mocked), and the
// registry resolver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "./helpers.js";
import {
  emptyUsage, totalTokens, estimateTokens, which, makeBackend,
} from "../lib/backends/base.js";
import { claudeBuildArgs, claudeParse } from "../lib/backends/claude.js";
import { geminiBuildArgs, geminiParse } from "../lib/backends/gemini.js";
import { codexBuildArgs, codexParse } from "../lib/backends/codex.js";
import { REGISTRY, resolveBackend, availableBackends } from "../lib/backends/index.js";

// ── base.js helpers ──────────────────────────────────────────────────────
test("emptyUsage is four zeroed counters", () => {
  assert.deepEqual(emptyUsage(), {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
  });
  assert.notEqual(emptyUsage(), emptyUsage(), "returns a fresh object each call");
});

test("totalTokens sums all usage buckets (partial objects allowed)", () => {
  assert.equal(totalTokens({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 }), 10);
  assert.equal(totalTokens({ outputTokens: 5 }), 5);
  assert.equal(totalTokens({}), 0);
});

test("estimateTokens is ceil(len/4)", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens(null), 0);
});

test("which detects commands on PATH", async () => {
  assert.equal(await which("node"), true);
  assert.equal(await which("__tb_definitely_not_a_command__"), false);
});

// ── claude spec ──────────────────────────────────────────────────────────
test("claudeBuildArgs appends --model only when set", () => {
  assert.deepEqual(claudeBuildArgs("hi", { model: "claude-opus-4-8" }),
    ["-p", "hi", "--output-format", "json", "--model", "claude-opus-4-8"]);
  assert.deepEqual(claudeBuildArgs("hi", {}), ["-p", "hi", "--output-format", "json"]);
  assert.deepEqual(claudeBuildArgs("hi"), ["-p", "hi", "--output-format", "json"]);
});

test("claudeParse maps a single result object", () => {
  const r = claudeParse(JSON.stringify({
    type: "result", result: "hello", total_cost_usd: 0.0123,
    usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
  }));
  assert.equal(r.text, "hello");
  assert.equal(r.costUsd, 0.0123);
  assert.equal(r.estimated, false);
  assert.deepEqual(r.usage, { inputTokens: 5, outputTokens: 7, cacheReadTokens: 3, cacheCreationTokens: 2 });
});

test("claudeParse finds the result event inside a stream array", () => {
  const r = claudeParse(JSON.stringify([
    { type: "system" }, { type: "assistant" },
    { type: "result", result: "done", usage: { output_tokens: 4 } },
  ]));
  assert.equal(r.text, "done");
  assert.equal(r.usage.outputTokens, 4);
  assert.equal(r.costUsd, 0, "missing total_cost_usd → 0");
});

test("claudeParse falls back from result to text field", () => {
  const r = claudeParse(JSON.stringify({ type: "result", text: "viaText" }));
  assert.equal(r.text, "viaText");
});

test("claudeParse surfaces is_error as a retryable failure", () => {
  const r = claudeParse(JSON.stringify({ type: "result", is_error: true, api_error_status: "overloaded_error", subtype: "error" }));
  assert.equal(r.ok, false);
  assert.equal(r.error, "overloaded_error");
});

test("claudeParse treats a non-allowed rate_limit_event as a blocked failure with resetAt", () => {
  const r = claudeParse(JSON.stringify([
    { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 99 } },
    { type: "result" },
  ]));
  assert.equal(r.ok, false);
  assert.equal(r.error, "rejected");
  assert.equal(r.resetAt, 99);
});

test("claudeParse lets an allowed rate_limit_event through to success", () => {
  const r = claudeParse(JSON.stringify([
    { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
    { type: "result", result: "ok", usage: { output_tokens: 2 } },
  ]));
  assert.notEqual(r.ok, false);
  assert.equal(r.text, "ok");
});

// ── gemini + codex specs ─────────────────────────────────────────────────
test("gemini spec builds args and estimates usage", () => {
  assert.deepEqual(geminiBuildArgs("hi"), ["-p", "hi"]);
  const r = geminiParse("  out  ");
  assert.equal(r.text, "out");
  assert.equal(r.estimated, true);
  assert.equal(r.usage.outputTokens, estimateTokens("out"));
});

test("codex spec builds args and estimates usage", () => {
  assert.deepEqual(codexBuildArgs("hi"), ["exec", "hi"]);
  const r = codexParse("  hello world  ");
  assert.equal(r.text, "hello world");
  assert.equal(r.estimated, true);
  assert.equal(r.usage.outputTokens, estimateTokens("hello world"));
});

// ── makeBackend.run pipeline (real child process, no external CLI) ────────
const nodeBackend = (buildArgs, parse, extra = {}) =>
  makeBackend({ name: "t", label: "T", cmd: process.execPath, buildArgs, parse, ...extra });

test("run returns ok with normalized usage on clean output", async () => {
  const b = nodeBackend(() => ["-e", "process.stdout.write('OUTPUT')"], (s) => ({ text: s.trim() }));
  const r = await b.run("p", config({ timeoutMs: 5000 }));
  assert.equal(r.ok, true);
  assert.equal(r.text, "OUTPUT");
  assert.equal(r.costUsd, 0);
  assert.equal(r.estimated, false);
  assert.deepEqual(r.usage, emptyUsage(), "missing usage filled with zeros");
  assert.equal(typeof r.durationMs, "number");
});

test("run fails when the child writes nothing", async () => {
  const b = nodeBackend(() => ["-e", "process.exit(2)"], (s) => ({ text: s }));
  const r = await b.run("p", config({ timeoutMs: 5000 }));
  assert.equal(r.ok, false);
  assert.equal(r.error, "exit 2");
  assert.equal(r.text, "");
});

test("run wraps a parse() throw as a parse error", async () => {
  const b = nodeBackend(() => ["-e", "process.stdout.write('notjson')"], (s) => JSON.parse(s));
  const r = await b.run("p", config({ timeoutMs: 5000 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /^parse:/);
});

test("run surfaces a spec-reported api failure with resetAt", async () => {
  const b = nodeBackend(() => ["-e", "process.stdout.write('x')"], () => ({ ok: false, error: "boom", raw: "r", resetAt: 42 }));
  const r = await b.run("p", config({ timeoutMs: 5000 }));
  assert.equal(r.ok, false);
  assert.equal(r.error, "boom");
  assert.equal(r.resetAt, 42);
});

test("run kills and fails a child that exceeds the timeout", async () => {
  const b = nodeBackend(() => ["-e", "setTimeout(() => {}, 10000)"], (s) => ({ text: s }));
  const r = await b.run("p", config({ timeoutMs: 300 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout/);
});

test("makeBackend surfaces a metered flag and a stable shape", () => {
  assert.equal(nodeBackend(() => [], () => ({}), { metered: true }).metered, true);
  assert.equal(nodeBackend(() => [], () => ({})).metered, false, "defaults to false");
  const b = nodeBackend(() => [], () => ({}));
  assert.deepEqual(Object.keys(b).sort(), ["available", "cmd", "label", "metered", "name", "run"]);
});

// ── registry wiring ──────────────────────────────────────────────────────
test("REGISTRY exposes the four providers with metered flags", () => {
  assert.deepEqual(Object.keys(REGISTRY), ["claude", "gemini", "codex", "mock"]);
  assert.equal(REGISTRY.claude.metered, true, "claude reports real accounting");
  assert.equal(REGISTRY.gemini.metered, false);
  assert.equal(REGISTRY.codex.metered, false);
  assert.equal(REGISTRY.mock.metered, false, "mock is estimated, same shape as the rest");
});

test("resolveBackend returns an available backend, case-insensitively", async () => {
  assert.equal((await resolveBackend("mock")).name, "mock");
  assert.equal((await resolveBackend("MOCK")).name, "mock");
});

test("resolveBackend rejects an unknown backend with the valid list", async () => {
  await assert.rejects(() => resolveBackend("nope"), /unknown backend "nope"\. try one of: claude, gemini, codex, mock/);
});

test("availableBackends always includes mock", async () => {
  const avail = await availableBackends();
  assert.ok(Array.isArray(avail));
  assert.ok(avail.includes("mock"));
});

test("resolveBackend rejects a known backend whose CLI is not on PATH", async () => {
  const saved = REGISTRY.gemini.available;
  REGISTRY.gemini.available = async () => false;
  try {
    await assert.rejects(() => resolveBackend("gemini"), /backend "gemini" is not available/);
  } finally {
    REGISTRY.gemini.available = saved;
  }
});
