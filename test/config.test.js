// Unit tests for lib/core/config.js — the single source of truth for runtime config.
// parseConfig turns argv into a frozen, sanitized Config; modeInfo/modelLabel are
// the display resolvers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, parseDuration, MODES, DEFAULT_MODE, UNLIMITED_CONCURRENCY, modeInfo, modelLabel } from "../lib/core/config.js";

test("defaults are sane and the result is frozen", () => {
  const cfg = parseConfig([]);
  assert.equal(cfg.backend, "claude");
  assert.equal(cfg.mode, DEFAULT_MODE);
  assert.equal(cfg.model, MODES[DEFAULT_MODE].model);
  assert.equal(cfg.count, Infinity, "no --count → an endless run");
  assert.equal(cfg.infinite, true, "endless by default");
  assert.equal(cfg.concurrency, 6, "6 agents in parallel by default (machine-safe; ~1 GB RAM each)");
  assert.equal(cfg.runForMs, null, "no time budget by default (burns forever)");
  assert.equal(cfg.retry, true);
  assert.ok(Object.isFrozen(cfg));
});

test("boolean flags flip their fields", () => {
  assert.equal(parseConfig(["--plain"]).plain, true);
  assert.equal(parseConfig(["--forest"]).forest, true);
  assert.equal(parseConfig(["--yes"]).assumeYes, true);
  assert.equal(parseConfig(["--no-retry"]).retry, false);
  assert.equal(parseConfig(["--no-animate"]).animate, false);
  assert.equal(parseConfig(["--no-anim"]).animate, false);
});

test("--dry selects the mock backend", () => {
  const cfg = parseConfig(["--dry"]);
  assert.equal(cfg.dry, true);
  assert.equal(cfg.backend, "mock");
});

test("budget tiers and their aliases pick the right model", () => {
  assert.equal(parseConfig(["--schwabe"]).model, MODES.schwabe.model);
  assert.equal(parseConfig(["--student"]).model, MODES.student.model);
  assert.equal(parseConfig(["--rich"]).model, MODES.rich.model);
  assert.equal(parseConfig(["--whale"]).model, MODES.whale.model, "--whale is the fable 5 apex tier");
  assert.equal(parseConfig(["--broke"]).mode, "schwabe");
  assert.equal(parseConfig(["--peasant"]).mode, "schwabe", "legacy --peasant aliases to schwabe");
  assert.equal(parseConfig(["--poor"]).mode, "student");
  assert.equal(parseConfig(["--baller"]).mode, "rich");
  assert.equal(parseConfig(["--fable"]).mode, "whale", "--fable aliases to whale");
});

test("--mode picks a tier; an unknown tier falls back to the default", () => {
  assert.equal(parseConfig(["--mode", "student"]).mode, "student");
  assert.equal(parseConfig(["--mode", "student"]).model, MODES.student.model);
  assert.equal(parseConfig(["--mode", "bogus"]).mode, DEFAULT_MODE);
});

test("--model overrides the mode-derived model", () => {
  const cfg = parseConfig(["--schwabe", "--model", "custom-x"]);
  assert.equal(cfg.mode, "schwabe");
  assert.equal(cfg.model, "custom-x");
});

test("count/concurrency: --fleet aliases count, concurrency clamps to count, min 1", () => {
  assert.equal(parseConfig(["--count", "50"]).count, 50);
  assert.equal(parseConfig(["--fleet", "7"]).count, 7);
  assert.equal(parseConfig(["--count", "3"]).concurrency, 3, "default 6 clamped down to count 3");
  assert.equal(parseConfig(["--count", "3"]).infinite, false, "a fixed --count is not endless");
  assert.equal(parseConfig(["--concurrency", "100", "--count", "5"]).concurrency, 5);
  assert.equal(parseConfig(["--count", "0"]).count, 1, "floored at 1");
});

test("endless by default; --count makes it finite, --forever forces endless", () => {
  assert.equal(parseConfig([]).infinite, true);
  assert.equal(parseConfig(["--count", "24"]).infinite, false);
  assert.equal(parseConfig(["--forever"]).infinite, true);
  // An endless run is NOT clamped down to a finite count, so the default parallel survives.
  assert.equal(parseConfig([]).concurrency, 6);
});

test("--parallel sets concurrency (alias of --concurrency) without a count clamp when endless", () => {
  assert.equal(parseConfig(["--parallel", "250"]).concurrency, 250);
  assert.equal(parseConfig(["--concurrency", "7"]).concurrency, 7);
  assert.equal(parseConfig(["--parallel", "9", "--count", "5"]).concurrency, 5, "finite still clamps");
});

test("--unlimited cranks concurrency to UNLIMITED_CONCURRENCY and stays endless", () => {
  const cfg = parseConfig(["--unlimited"]);
  assert.equal(cfg.concurrency, UNLIMITED_CONCURRENCY);
  assert.equal(cfg.infinite, true);
  assert.equal(parseConfig(["--infinite"]).concurrency, UNLIMITED_CONCURRENCY, "--infinite is an alias");
  // A fixed --count still bounds an --unlimited run (and clamps concurrency to it).
  assert.equal(parseConfig(["--unlimited", "--count", "5"]).infinite, false);
  assert.equal(parseConfig(["--unlimited", "--count", "5"]).concurrency, 5);
});

test("--for / --timeout set an optional run-time budget in ms; junk → null", () => {
  assert.equal(parseConfig(["--for", "10m"]).runForMs, 600000);
  assert.equal(parseConfig(["--timeout", "30s"]).runForMs, 30000);
  assert.equal(parseConfig(["--for", "90"]).runForMs, 90000, "a bare number is seconds");
  assert.equal(parseConfig(["--for", "nonsense"]).runForMs, null);
  assert.equal(parseConfig([]).runForMs, null, "no budget unless asked");
});

test("parseDuration reads human durations into milliseconds", () => {
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("45s"), 45000);
  assert.equal(parseDuration("10m"), 600000);
  assert.equal(parseDuration("2h"), 7200000);
  assert.equal(parseDuration("1d"), 86400000);
  assert.equal(parseDuration("90"), 90000, "bare number defaults to seconds");
  assert.equal(parseDuration("1.5m"), 90000, "fractions allowed");
  assert.equal(parseDuration("garbage"), null);
  assert.equal(parseDuration(null), null);
});

test("non-finite or <=0 numeric flags fall back to defaults (NaN guard)", () => {
  assert.equal(parseConfig(["--timeoutMs", "oops"]).timeoutMs, 120000);
  assert.equal(parseConfig(["--retryBaseMs", "x"]).retryBaseMs, 3000);
  assert.equal(parseConfig(["--retryCapMs", "y"]).retryCapMs, 60000);
  assert.equal(parseConfig(["--timeoutMs", "-5"]).timeoutMs, 120000);
  assert.equal(parseConfig(["--timeoutMs", "5000"]).timeoutMs, 5000, "valid values are kept");
});

test("--as is consumed without disturbing later flags", () => {
  const cfg = parseConfig(["--as", "codex", "--schwabe"]);
  assert.equal(cfg.mode, "schwabe");
  assert.doesNotThrow(() => parseConfig(["--schwabe", "--as"]), "trailing --as is harmless");
});

test("--backend and --share pass through; bare args are ignored", () => {
  assert.equal(parseConfig(["--backend", "gemini"]).backend, "gemini");
  assert.equal(parseConfig(["--share", "x"]).share, "x");
  assert.equal(parseConfig(["hello", "--plain"]).plain, true);
});

test("modeInfo resolves tiers and falls back for unknowns", () => {
  assert.equal(modeInfo("rich").label, "RICH");
  assert.deepEqual(modeInfo("bogus"), { icon: "", label: "bogus" });
});

test("modelLabel drops the claude- prefix and defaults when unset", () => {
  assert.equal(modelLabel("claude-opus-4-8"), "opus-4-8");
  assert.equal(modelLabel(""), "default");
  assert.equal(modelLabel(undefined), "default");
});
