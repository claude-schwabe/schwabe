// Unit tests for lib/door/bouncer.js — the silent velvet-rope door. We exercise the
// pure detection logic (detectAgent) and the non-TTY codepath of bounce(), which
// the test process always takes (stdout is not a TTY), so animations are skipped
// and everything resolves fast. All console output is captured so the suite stays
// quiet; we never assert on the exact roast text, only the boolean verdict.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withStub } from "./helpers.js";
import { detectAgent, bounce } from "../lib/door/bouncer.js";

// Snapshot every sniff-relevant key, delete them all, and return a restorer.
// Also scrubs ANY other env key matching the bouncer's regexes so the baseline
// is a clean "guest" environment regardless of what the host process inherited.
function cleanEnv() {
  const re = /CLAUDECODE|CLAUDE_CODE|ANTHROPIC|CODEX|GEMINI/i;
  const saved = {};
  for (const k of Object.keys(process.env)) {
    if (re.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
  }
  return () => {
    for (const k of Object.keys(process.env)) if (re.test(k)) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  };
}

// Run fn with console.log/console.error silenced (captured) and restored after.
async function quiet(fn) {
  const lines = [];
  return withStub(console, "log", (...a) => lines.push(a.join(" ")), () =>
    withStub(console, "error", (...a) => lines.push(a.join(" ")), () => fn(lines)));
}

// ── detectAgent: the --as override ────────────────────────────────────────
test("detectAgent: --as override wins and is lowercased", () => {
  assert.equal(detectAgent(["--as", "codex"]), "codex");
  assert.equal(detectAgent(["--as", "GEMINI"]), "gemini");
  assert.equal(detectAgent(["--as", "Claude"]), "claude");
  assert.equal(detectAgent(["--as", "Guest"]), "guest");
});

test("detectAgent: --as anywhere in argv, surrounded by other flags", () => {
  assert.equal(detectAgent(["--forest", "--as", "CODEX", "--count", "5"]), "codex");
});

test("detectAgent: a trailing --as with no value falls through to env sniff", () => {
  const restore = cleanEnv();
  try {
    assert.equal(detectAgent(["--as"]), "guest", "no value → not an override, env is clean");
  } finally {
    restore();
  }
});

// ── detectAgent: env-sniff precedence (claude > codex > gemini > guest) ────
test("detectAgent: no flags, clean env → guest", () => {
  const restore = cleanEnv();
  try {
    assert.equal(detectAgent([]), "guest");
  } finally {
    restore();
  }
});

test("detectAgent: CLAUDECODE alone → claude", () => {
  const restore = cleanEnv();
  try {
    process.env.CLAUDECODE = "1";
    assert.equal(detectAgent([]), "claude");
  } finally {
    restore();
  }
});

test("detectAgent: ANTHROPIC-prefixed key alone → claude", () => {
  const restore = cleanEnv();
  try {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    assert.equal(detectAgent([]), "claude");
  } finally {
    restore();
  }
});

test("detectAgent: CODEX alone → codex", () => {
  const restore = cleanEnv();
  try {
    process.env.CODEX = "1";
    assert.equal(detectAgent([]), "codex");
  } finally {
    restore();
  }
});

test("detectAgent: GEMINI alone → gemini", () => {
  const restore = cleanEnv();
  try {
    process.env.GEMINI_API_KEY = "g-test";
    assert.equal(detectAgent([]), "gemini");
  } finally {
    restore();
  }
});

test("detectAgent: claude outranks codex and gemini", () => {
  const restore = cleanEnv();
  try {
    process.env.CLAUDECODE = "1";
    process.env.CODEX = "1";
    process.env.GEMINI = "1";
    assert.equal(detectAgent([]), "claude");
  } finally {
    restore();
  }
});

test("detectAgent: codex outranks gemini when claude is absent", () => {
  const restore = cleanEnv();
  try {
    process.env.CODEX = "1";
    process.env.GEMINI = "1";
    assert.equal(detectAgent([]), "codex");
  } finally {
    restore();
  }
});

test("detectAgent: --as override beats a conflicting env", () => {
  const restore = cleanEnv();
  try {
    process.env.CLAUDECODE = "1";
    assert.equal(detectAgent(["--as", "gemini"]), "gemini", "explicit override wins over env");
  } finally {
    restore();
  }
});

// ── bounce: the verdict (non-TTY path, fast, output captured) ──────────────
test("bounce: a claude badge is let in (true)", async () => {
  const ok = await quiet(() => bounce(["--as", "claude"]));
  assert.equal(ok, true);
});

test("bounce: a guest is let in (true)", async () => {
  const ok = await quiet(() => bounce(["--as", "guest"]));
  assert.equal(ok, true);
});

test("bounce: codex is denied (false)", async () => {
  const ok = await quiet(() => bounce(["--as", "codex"]));
  assert.equal(ok, false);
});

test("bounce: the gemini CLI is denied (false)", async () => {
  const ok = await quiet(() => bounce(["--as", "gemini"]));
  assert.equal(ok, false);
});

test("bounce: an unknown agent is treated as a guest and let in (true)", async () => {
  const ok = await quiet(() => bounce(["--as", "totally-unknown"]));
  assert.equal(ok, true);
});

test("bounce: resolves a Promise<boolean>", async () => {
  const ret = quiet(() => bounce(["--as", "claude"]));
  assert.ok(ret instanceof Promise);
  assert.equal(typeof (await ret), "boolean");
});

test("bounce: with no --as falls back to env sniff (clean env → guest, true)", async () => {
  const restore = cleanEnv();
  try {
    const ok = await quiet(() => bounce([]));
    assert.equal(ok, true, "guest is admitted");
  } finally {
    restore();
  }
});

test("bounce: env-sniffed codex is denied (false)", async () => {
  const restore = cleanEnv();
  try {
    process.env.CODEX = "1";
    const ok = await quiet(() => bounce([]));
    assert.equal(ok, false);
  } finally {
    restore();
  }
});
