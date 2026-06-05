// Unit tests for lib/backends/mock.js — the zero-spend dev backend used by --dry.
// TB_FAIL_FIRST is read at module load, so we set it BEFORE importing mock to
// also exercise the simulated rate-limit (retry-recovery) path. random is stubbed
// for deterministic success output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withStub } from "./helpers.js";
import { estimateTokens, emptyUsage } from "../lib/backends/base.js";
import { FOREST_MARKER, TREE_W } from "../lib/forest/index.js";

process.env.TB_FAIL_FIRST = "1";
const { mock } = await import("../lib/backends/mock.js");

test("mock has the standard backend shape and is always available", async () => {
  assert.equal(mock.name, "mock");
  assert.equal(await mock.available(), true);
});

test("mock.run: the first call simulates a retryable rate-limit failure", async () => {
  const r = await mock.run("anything");
  assert.equal(r.ok, false);
  assert.match(r.error, /rate limit/i);
  assert.equal(r.estimated, true);
  assert.equal(typeof r.resetAt, "number");
  assert.deepEqual(r.usage, emptyUsage());
});

test("mock.run: a normal call returns an estimated success with usage", async () => {
  const r = await withStub(Math, "random", () => 0, () => mock.run("hello"));
  assert.equal(r.ok, true);
  assert.equal(r.estimated, true);
  assert.equal(r.costUsd, 0);
  assert.ok(r.text.length > 0);
  assert.equal(r.usage.inputTokens, estimateTokens("hello"));
  assert.ok(r.usage.outputTokens > 0);
});

test("mock.run: a forest-marker prompt returns the canned ASCII tree block", async () => {
  const r = await withStub(Math, "random", () => 0, () => mock.run("please " + FOREST_MARKER));
  assert.equal(r.ok, true);
  const lines = r.text.split("\n");
  assert.equal(lines.length, 9);
  for (const ln of lines) assert.equal(ln.length, TREE_W);
});
