// Unit tests for lib/core/util.js — the shared low-level helpers. Pure and
// dependency-free, so every function is tested in isolation. This file is the
// reference standard the rest of the suite mirrors.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESC, RESET, sgr, fg, bg, paint, clamp, nf, usd, sleep, now, hms,
  gradient, stripAnsi, visLen, truncVisible, padEndVisible, fit, EMA,
  C, applyTheme, detectLightSync, initTheme,
} from "../lib/core/util.js";

test("ANSI builders", () => {
  assert.equal(ESC, "\x1b[");
  assert.equal(RESET, "\x1b[0m");
  assert.equal(sgr(1), "\x1b[1m");
  assert.equal(sgr(38, 2, 255, 0, 0), "\x1b[38;2;255;0;0m");
  assert.equal(fg(255, 0, 0), "\x1b[38;2;255;0;0m");
  assert.equal(bg(0, 128, 255), "\x1b[48;2;0;128;255m");
});

test("paint wraps with a trailing reset", () => {
  assert.equal(paint("\x1b[31m", "x"), "\x1b[31mx\x1b[0m");
  assert.equal(paint("", ""), "\x1b[0m");
});

test("clamp bounds a value", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
  assert.equal(clamp(7, 7, 7), 7);
});

test("nf rounds and groups; null/undefined → 0", () => {
  assert.equal(nf(1234.5), "1,235");
  assert.equal(nf(999), "999");
  assert.equal(nf(0), "0");
  assert.equal(nf(undefined), "0");
  assert.equal(nf(null), "0");
  assert.equal(nf(1000000), "1,000,000");
});

test("usd formats four decimals; null/undefined → $0.0000", () => {
  assert.equal(usd(0), "$0.0000");
  assert.equal(usd(1.5), "$1.5000");
  assert.equal(usd(undefined), "$0.0000");
  assert.equal(usd(0.00012345), "$0.0001");
});

test("hms is mm:ss, minutes can exceed 59 (no hour rollover)", () => {
  assert.equal(hms(0), "00:00");
  assert.equal(hms(1000), "00:01");
  assert.equal(hms(60000), "01:00");
  assert.equal(hms(65000), "01:05");
  assert.equal(hms(3599000), "59:59");
});

test("sleep resolves after the delay", async () => {
  const t0 = now();
  await sleep(20);
  assert.ok(now() - t0 >= 15, "slept roughly the requested time");
});

test("now is a non-decreasing finite millisecond clock", () => {
  const a = now();
  const b = now();
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  assert.ok(b >= a);
});

test("gradient is a truecolor fg string, clamped to [0,1]", () => {
  assert.equal(gradient(0), fg(46, 204, 64));
  assert.equal(gradient(0.5), fg(255, 220, 0));
  assert.equal(gradient(1), fg(255, 59, 48));
  assert.equal(gradient(-99), gradient(0), "below range clamps to 0");
  assert.equal(gradient(99), gradient(1), "above range clamps to 1");
});

test("stripAnsi / visLen ignore SGR sequences", () => {
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m"), "red");
  assert.equal(visLen("\x1b[1;32mhi\x1b[0m"), 2);
  assert.equal(visLen("plain"), 5);
});

test("truncVisible keeps ANSI but caps visible width", () => {
  const out = truncVisible("\x1b[31mabcdef\x1b[0m", 3);
  assert.equal(visLen(out), 3);
  assert.ok(out.includes("\x1b[31m"), "color code preserved");
  assert.ok(out.endsWith(RESET), "reset appended once truncated");
  // shorter-than-width strings pass their visible content through untouched
  assert.equal(visLen(truncVisible("ab", 10)), 2);
});

test("padEndVisible pads to the visible width with spaces", () => {
  assert.equal(padEndVisible("ab", 5), "ab   ");
  assert.equal(visLen(padEndVisible("\x1b[31mab\x1b[0m", 5)), 5);
  assert.equal(padEndVisible("toolong", 3), "toolong", "never truncates");
});

test("fit produces exactly w visible columns", () => {
  for (const [s, w] of [["abcdef", 3], ["ab", 5], ["\x1b[31mabcdef\x1b[0m", 4], ["", 6]]) {
    assert.equal(visLen(fit(s, w)), w, `fit(${JSON.stringify(s)}, ${w})`);
  }
});

test("EMA seeds on first push then blends", () => {
  const e = new EMA(0.5);
  assert.equal(e.push(10), 10);
  assert.equal(e.push(20), 15);
  assert.equal(e.push(20), 17.5);
});

test("detectLightSync reads the background field of COLORFGBG", () => {
  const prev = process.env.COLORFGBG;
  try {
    process.env.COLORFGBG = "0;15";
    assert.equal(detectLightSync(), true, "bg 15 is a light terminal");
    process.env.COLORFGBG = "15;0";
    assert.equal(detectLightSync(), false, "bg 0 is a dark terminal");
    process.env.COLORFGBG = "1;7";
    assert.equal(detectLightSync(), true, "bg 7 is light");
    delete process.env.COLORFGBG;
    assert.equal(detectLightSync(), false, "unset → assume dark");
  } finally {
    if (prev === undefined) delete process.env.COLORFGBG; else process.env.COLORFGBG = prev;
  }
});

test("applyTheme swaps the live palette and records isLight", () => {
  const snapshot = { ...C };
  try {
    applyTheme(true);
    assert.equal(C.isLight, true);
    assert.equal(C.red, fg(200, 40, 32), "light red is ink-dark");
    applyTheme(false);
    assert.equal(C.isLight, false);
    assert.equal(C.red, sgr(31), "dark red is the 16-color code");
  } finally {
    Object.assign(C, snapshot);
  }
});

test("initTheme resolves to a boolean and applies it (no probe when COLORFGBG set)", async () => {
  const prev = process.env.COLORFGBG;
  const snapshot = { ...C };
  try {
    process.env.COLORFGBG = "0;15";
    const light = await initTheme();
    assert.equal(typeof light, "boolean");
    assert.equal(light, true);
    assert.equal(C.isLight, true);
  } finally {
    if (prev === undefined) delete process.env.COLORFGBG; else process.env.COLORFGBG = prev;
    Object.assign(C, snapshot);
  }
});

test("initTheme falls back to the sync guess when COLORFGBG is unset (OSC probe is null off-TTY)", async () => {
  const prev = process.env.COLORFGBG;
  const snapshot = { ...C };
  try {
    delete process.env.COLORFGBG;            // forces the probeBgColor() path
    const light = await initTheme();          // off-TTY → probe resolves null → sync guess (dark)
    assert.equal(light, false);
    assert.equal(C.isLight, false);
  } finally {
    if (prev === undefined) delete process.env.COLORFGBG; else process.env.COLORFGBG = prev;
    Object.assign(C, snapshot);
  }
});
