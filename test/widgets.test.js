// Unit tests for lib/ui/widgets.js — the btop-idiom terminal widgets
// (spinner, meter, sparkline, box, kv). These are pure string builders; we
// assert on the ANSI-stripped / visible-width form via util's stripAnsi/visLen
// so we never hard-code raw escape codes and verify the alignment invariants
// (each meter/sparkline/box line is exactly `width` visible columns).

import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAnsi, visLen } from "../lib/core/util.js";
import { spinner, meter, sparkline, box, kv } from "../lib/ui/widgets.js";

// ── spinner ────────────────────────────────────────────────────────────────
test("spinner cycles a 10-frame braille set and wraps modularly", () => {
  const frames = Array.from({ length: 10 }, (_, i) => spinner(i));
  assert.equal(new Set(frames).size, 10, "ten distinct frames");
  for (const f of frames) assert.equal(visLen(f), 1, "each frame is one visible column");
  assert.equal(spinner(0), "⠋");
  assert.equal(spinner(0), spinner(10), "wraps after ten frames");
  assert.equal(spinner(13), spinner(3), "index is taken modulo the frame count");
});

// ── meter ────────────────────────────────────────────────────────────────
test("meter has exactly `width` visible cells regardless of frac", () => {
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    assert.equal(visLen(meter(frac, 10)), 10, `frac=${frac}`);
  }
});

test("meter clamps frac to [0,1]", () => {
  // out-of-range fracs still produce a width-correct bar identical to the bound
  assert.equal(stripAnsi(meter(-5, 8)), stripAnsi(meter(0, 8)), "below 0 clamps to empty");
  assert.equal(stripAnsi(meter(99, 8)), stripAnsi(meter(1, 8)), "above 1 clamps to full");
});

test("meter at frac=0 is all empty cells, at frac=1 all filled cells", () => {
  assert.equal(stripAnsi(meter(0, 6)), "▯".repeat(6), "empty uses the hollow glyph");
  assert.equal(stripAnsi(meter(1, 6)), "▮".repeat(6), "full uses the solid glyph");
});

test("meter fills round(frac*width) leading cells", () => {
  // frac=0.5 of width 6 → 3 filled, 3 empty (filled cells come first)
  assert.equal(stripAnsi(meter(0.5, 6)), "▮▮▮▯▯▯");
});

test("meter width 0 yields an empty (zero-column) bar", () => {
  assert.equal(visLen(meter(0.5, 0)), 0);
  assert.equal(stripAnsi(meter(0.5, 0)), "");
});

// ── sparkline ──────────────────────────────────────────────────────────────
test("sparkline is exactly `width` visible columns when the series fits", () => {
  assert.equal(visLen(sparkline([1, 2, 3, 4], 4)), 4);
  assert.equal(visLen(sparkline([5, 1, 9, 2, 7, 3], 6)), 6);
});

test("sparkline pads a short series with trailing dots to fill `width`", () => {
  const out = stripAnsi(sparkline([4, 4], 5));
  assert.equal(out.length, 5, "padded to full width");
  assert.equal(out.slice(-3), "···", "short series gets trailing dots");
});

test("sparkline with empty input is all dots", () => {
  assert.equal(stripAnsi(sparkline([], 7)), "·".repeat(7));
  assert.equal(visLen(sparkline([], 7)), 7);
});

test("sparkline keeps only the last `width` values when the series is too long", () => {
  // 8 values into width 4 → tail kept, no dot padding, exactly width columns
  const out = stripAnsi(sparkline([1, 2, 3, 4, 5, 6, 7, 8], 4));
  assert.equal(out.length, 4);
  assert.ok(!out.includes("·"), "a full window needs no dot padding");
});

test("sparkline maps the max value to the tallest bar and scales the rest", () => {
  // max → █ (top of the 8-step ramp); a small value → a low bar
  const out = stripAnsi(sparkline([1, 8], 2));
  assert.equal(out.length, 2);
  assert.equal(out[1], "█", "the max value renders as the full block");
});

// ── box ────────────────────────────────────────────────────────────────────
test("box returns an array whose every line is exactly `width` visible columns", () => {
  const out = box({ title: "T", width: 20, lines: ["a", "bb", "ccc"], footer: "F" });
  assert.ok(Array.isArray(out));
  for (const ln of out) assert.equal(visLen(ln), 20, `line: ${JSON.stringify(stripAnsi(ln))}`);
});

test("box first line is the top border and last line is the bottom border", () => {
  const out = box({ width: 16, lines: ["x"] });
  const first = stripAnsi(out[0]);
  const last = stripAnsi(out.at(-1));
  assert.ok(first.startsWith("╭") && first.endsWith("╮"), "top border corners");
  assert.ok(last.startsWith("╰") && last.endsWith("╯"), "bottom border corners");
});

test("box has one body line per supplied line, in order", () => {
  const lines = ["alpha", "beta", "gamma"];
  const out = box({ width: 18, lines });
  assert.equal(out.length, lines.length + 2, "top + body + bottom");
  out.slice(1, -1).forEach((ln, i) => {
    assert.ok(stripAnsi(ln).includes(lines[i]), `body line ${i} contains its content`);
  });
});

test("box renders the title in the top border and footer in the bottom border", () => {
  const out = box({ title: "STATS", width: 24, lines: [""], footer: "done" });
  assert.ok(stripAnsi(out[0]).includes("STATS"), "title shows on the top border");
  assert.ok(stripAnsi(out.at(-1)).includes("done"), "footer shows on the bottom border");
});

test("box keeps body lines width-correct even when content overflows the inner width", () => {
  const out = box({ width: 10, lines: ["this content is way too long to fit"] });
  for (const ln of out) assert.equal(visLen(ln), 10);
});

test("box stays width-correct with no title and no footer", () => {
  const out = box({ width: 12, lines: ["only body"] });
  for (const ln of out) assert.equal(visLen(ln), 12);
  // with no title/footer the borders are an unbroken run of horizontals
  assert.equal(stripAnsi(out[0]), "╭" + "─".repeat(10) + "╮");
  assert.equal(stripAnsi(out.at(-1)), "╰" + "─".repeat(10) + "╯");
});

test("box preserves pre-colored body content (ANSI passes through)", () => {
  const colored = "\x1b[31mred\x1b[0m";
  const out = box({ width: 14, lines: [colored] });
  const body = out[1];
  assert.ok(body.includes("\x1b[31m"), "embedded color code survives");
  assert.ok(stripAnsi(body).includes("red"), "visible text survives");
  assert.equal(visLen(body), 14, "still width-correct with ANSI inside");
});

// ── kv ───────────────────────────────────────────────────────────────────
test("kv has visLen === width and right-aligns the value", () => {
  const out = kv("label", "42", 20);
  assert.equal(visLen(out), 20);
  const plain = stripAnsi(out);
  assert.ok(plain.startsWith("label"), "label is left-aligned");
  assert.ok(plain.endsWith("42"), "value is right-aligned to the edge");
});

test("kv keeps at least one space of gap between label and value", () => {
  // when label+value exactly fill width there is still a single-space minimum gap
  const out = kv("abc", "xyz", 6); // 3 + 3 = 6, gap forced to 1 → 7 wide
  const plain = stripAnsi(out);
  assert.match(plain, /^abc +xyz$/, "label, gap of spaces, then value");
  assert.ok(/abc xyz/.test(plain.replace(/ +/, " ")), "at least one separating space");
});

test("kv measures visible width of colored label/value, not raw bytes", () => {
  const out = kv("\x1b[34mname\x1b[0m", "\x1b[32m9\x1b[0m", 12);
  assert.equal(visLen(out), 12, "ANSI in label/value does not inflate the width");
  const plain = stripAnsi(out);
  assert.ok(plain.startsWith("name") && plain.endsWith("9"));
});
