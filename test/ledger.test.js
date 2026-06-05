// Unit tests for lib/engine/ledger.js — the persistent record (burns.csv + ashes.jsonl).
// Covers: CSV_HEADER shape; parseLine (plain split, quoted commas, escaped "",
// trailing empty field); the Ledger class (header bootstrap on construction,
// record() emitting one correct CSV row + one JSON line); and loadLifetime
// (missing file, summed totals over N rows, skipping malformed short lines).
// Every filesystem path is routed through tmp(); temp dirs cleaned via t.after.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmp, result } from "./helpers.js";
import { CSV_HEADER, Ledger, parseLine, loadLifetime } from "../lib/engine/ledger.js";

// A simple agent stand-in: just the { id, label } the ledger reads (+ optional adj).
const agent = (o = {}) => ({ id: "a1", label: "write a haiku", adj: "cynical", ...o });

// Spin up a Ledger over fresh temp paths; registers cleanup on the test ctx.
function ledger(t, opts = {}) {
  const box = tmp();
  t.after(box.cleanup);
  const csvPath = box.file("burns.csv");
  const jsonlPath = box.file("ashes.jsonl");
  const led = new Ledger({
    csvPath, jsonlPath, runId: "run-1", model: "claude-opus-4-8", backend: "mock", ...opts,
  });
  return { box, led, csvPath, jsonlPath };
}

// ── CSV_HEADER ─────────────────────────────────────────────────────────────
test("CSV_HEADER lists the fifteen columns in order", () => {
  assert.deepEqual(CSV_HEADER, [
    "ts", "run_id", "agent", "backend", "model", "task",
    "input_tokens", "output_tokens", "cache_read", "cache_creation",
    "total_tokens", "cost_usd", "duration_ms", "ok", "estimated",
  ]);
});

// ── parseLine ──────────────────────────────────────────────────────────────
test("parseLine splits a plain comma row", () => {
  assert.deepEqual(parseLine("a,b,c"), ["a", "b", "c"]);
});

test("parseLine keeps commas inside quoted fields", () => {
  assert.deepEqual(parseLine('a,"b,c,d",e'), ["a", "b,c,d", "e"]);
});

test('parseLine unescapes doubled "" inside quotes', () => {
  assert.deepEqual(parseLine('"he said ""hi""",x'), ['he said "hi"', "x"]);
});

test("parseLine preserves a trailing empty field", () => {
  assert.deepEqual(parseLine("a,b,"), ["a", "b", ""]);
});

test("parseLine returns a single field when there are no commas", () => {
  assert.deepEqual(parseLine("solo"), ["solo"]);
  assert.deepEqual(parseLine(""), [""]);
});

// ── Ledger construction ──────────────────────────────────────────────────────
test("Ledger writes the header when the CSV is missing", (t) => {
  const { csvPath } = ledger(t);
  assert.equal(readFileSync(csvPath, "utf8"), CSV_HEADER.join(",") + "\n");
});

test("Ledger writes the header when the CSV exists but is empty", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const csvPath = box.file("burns.csv");
  writeFileSync(csvPath, "   \n");
  new Ledger({ csvPath, jsonlPath: box.file("ashes.jsonl"), runId: "r", model: "m", backend: "mock" });
  assert.equal(readFileSync(csvPath, "utf8"), CSV_HEADER.join(",") + "\n");
});

test("Ledger does not clobber a CSV that already has content", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const csvPath = box.file("burns.csv");
  const existing = CSV_HEADER.join(",") + "\nrow,already,here\n";
  writeFileSync(csvPath, existing);
  new Ledger({ csvPath, jsonlPath: box.file("ashes.jsonl"), runId: "r", model: "m", backend: "mock" });
  assert.equal(readFileSync(csvPath, "utf8"), existing, "left untouched");
});

// ── Ledger.record ────────────────────────────────────────────────────────────
test("record appends one CSV row with columns mapped correctly", (t) => {
  const { led, csvPath } = ledger(t);
  const r = result({
    usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 3 },
    costUsd: 0.0123, durationMs: 42.6, ok: true, estimated: false,
  });
  led.record(agent({ id: "agent-7", label: "write a sonnet" }), r);

  const lines = readFileSync(csvPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2, "header + one row");
  const cols = parseLine(lines[1]);
  assert.equal(cols.length, CSV_HEADER.length);

  const col = (name) => cols[CSV_HEADER.indexOf(name)];
  assert.equal(col("run_id"), "run-1");
  assert.equal(col("agent"), "agent-7");
  assert.equal(col("backend"), "mock");
  assert.equal(col("model"), "claude-opus-4-8");
  assert.equal(col("task"), "write a sonnet");
  assert.equal(col("input_tokens"), "10");
  assert.equal(col("output_tokens"), "20");
  assert.equal(col("cache_read"), "5");
  assert.equal(col("cache_creation"), "3");
  assert.equal(col("total_tokens"), "38", "sum of all four usage buckets");
  assert.equal(col("cost_usd"), "0.012300", "cost fixed to six decimals");
  assert.equal(col("duration_ms"), "43", "duration rounded");
  assert.equal(col("ok"), "1");
  assert.equal(col("estimated"), "0");
  // ts is an ISO timestamp
  assert.ok(!Number.isNaN(Date.parse(col("ts"))), "ts parses as a date");
});

test("record encodes ok=0 and estimated=1 for a failed estimated result", (t) => {
  const { led, csvPath } = ledger(t);
  led.record(agent(), result({ ok: false, estimated: true, costUsd: 0 }));
  const cols = parseLine(readFileSync(csvPath, "utf8").trim().split("\n")[1]);
  assert.equal(cols[CSV_HEADER.indexOf("ok")], "0");
  assert.equal(cols[CSV_HEADER.indexOf("estimated")], "1");
  assert.equal(cols[CSV_HEADER.indexOf("cost_usd")], "0.000000");
});

test("record quotes a task label containing a comma so columns stay aligned", (t) => {
  const { led, csvPath } = ledger(t);
  led.record(agent({ label: "haiku, about, fire" }), result());
  const lines = readFileSync(csvPath, "utf8").trim().split("\n");
  const cols = parseLine(lines[1]);
  assert.equal(cols.length, CSV_HEADER.length, "comma inside the label did not add columns");
  assert.equal(cols[CSV_HEADER.indexOf("task")], "haiku, about, fire");
});

test("record appends one matching JSON line to the jsonl", (t) => {
  const { led, jsonlPath } = ledger(t);
  const r = result({
    usage: { inputTokens: 4, outputTokens: 8 },
    text: "a fine masterpiece", costUsd: 0.5, ok: true, error: undefined,
  });
  led.record(agent({ id: "ag-x", label: "a task", adj: "darkly cynical" }), r);

  const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const obj = JSON.parse(lines[0]);
  assert.equal(obj.runId, "run-1");
  assert.equal(obj.agent, "ag-x");
  assert.equal(obj.backend, "mock");
  assert.equal(obj.model, "claude-opus-4-8");
  assert.equal(obj.task, "a task");
  assert.equal(obj.adj, "darkly cynical");
  assert.equal(obj.ok, true);
  assert.equal(obj.costUsd, 0.5);
  assert.equal(obj.text, "a fine masterpiece");
  assert.deepEqual(obj.usage, { inputTokens: 4, outputTokens: 8, cacheReadTokens: 0, cacheCreationTokens: 0 });
  assert.ok(!Number.isNaN(Date.parse(obj.ts)));
});

test("record accumulates rows across multiple calls", (t) => {
  const { led, csvPath, jsonlPath } = ledger(t);
  led.record(agent({ id: "a" }), result({ usage: { outputTokens: 1 } }));
  led.record(agent({ id: "b" }), result({ usage: { outputTokens: 2 } }));
  led.record(agent({ id: "c" }), result({ usage: { outputTokens: 3 } }));
  assert.equal(readFileSync(csvPath, "utf8").trim().split("\n").length, 4, "header + 3 rows");
  assert.equal(readFileSync(jsonlPath, "utf8").trim().split("\n").length, 3);
});

// ── loadLifetime ─────────────────────────────────────────────────────────────
test("loadLifetime returns zeros for a missing file", () => {
  const box = tmp();
  try {
    assert.deepEqual(loadLifetime(box.file("nope.csv")), { rows: 0, tokens: 0, cost: 0 });
  } finally {
    box.cleanup();
  }
});

test("loadLifetime returns zeros for a header-only CSV", (t) => {
  const { csvPath } = ledger(t);
  assert.deepEqual(loadLifetime(csvPath), { rows: 0, tokens: 0, cost: 0 });
});

test("loadLifetime sums total_tokens and cost_usd over recorded rows", (t) => {
  const { led, csvPath } = ledger(t);
  led.record(agent({ id: "a" }), result({ usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.10 }));
  led.record(agent({ id: "b" }), result({ usage: { outputTokens: 7, cacheReadTokens: 3 }, costUsd: 0.25 }));
  const life = loadLifetime(csvPath);
  assert.equal(life.rows, 2);
  assert.equal(life.tokens, 25, "(10+5) + (7+3)");
  assert.ok(Math.abs(life.cost - 0.35) < 1e-9, "0.10 + 0.25");
});

test("loadLifetime skips malformed short lines", (t) => {
  const { led, csvPath } = ledger(t);
  led.record(agent({ id: "good" }), result({ usage: { outputTokens: 9 }, costUsd: 0.5 }));
  // A truncated row with fewer than CSV_HEADER.length columns must be ignored.
  appendFileSync(csvPath, "broken,row,too,short\n");
  const life = loadLifetime(csvPath);
  assert.equal(life.rows, 1, "only the well-formed row counts");
  assert.equal(life.tokens, 9);
  assert.ok(Math.abs(life.cost - 0.5) < 1e-9);
});
