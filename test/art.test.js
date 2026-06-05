// Unit tests for the denial-card art pipeline: lib/door/art/png.js (from-scratch PNG
// encoder + Canvas), lib/door/art/pixel-art.js (5×7 font + text/icon drawing), and
// lib/door/art/img.js (PNG → ANSI half-block renderer). The encode→decode round-trip is
// exercised through a real tmp() file; everything else is a pure builder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmp } from "./helpers.js";
import { encodePNG, Canvas } from "../lib/door/art/png.js";
import {
  FONT, glyph, textW, drawText, drawCentered, noEntry, border,
} from "../lib/door/art/pixel-art.js";
import { pngToAnsi } from "../lib/door/art/img.js";

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Read one pixel's [r,g,b] straight out of a Canvas's .px buffer.
const px = (cv, x, y) => {
  const i = (y * cv.w + x) * 3;
  return [cv.px[i], cv.px[i + 1], cv.px[i + 2]];
};

// ── png.js: encodePNG ────────────────────────────────────────────────────
test("encodePNG returns a Buffer beginning with the 8-byte PNG signature", () => {
  const rgb = Buffer.alloc(2 * 2 * 3, 0);
  const buf = encodePNG({ width: 2, height: 2, rgb });
  assert.ok(Buffer.isBuffer(buf));
  assert.deepEqual(buf.subarray(0, 8), PNG_SIG);
});

test("encodePNG embeds an IHDR with the right dimensions and RGB color type", () => {
  const rgb = Buffer.alloc(3 * 2 * 3, 0);
  const buf = encodePNG({ width: 3, height: 2, rgb });
  // IHDR chunk data starts at byte 16 (8 sig + 4 len + 4 type "IHDR").
  assert.equal(buf.toString("ascii", 12, 16), "IHDR");
  assert.equal(buf.readUInt32BE(16), 3, "width");
  assert.equal(buf.readUInt32BE(20), 2, "height");
  assert.equal(buf[24], 8, "8-bit depth");
  assert.equal(buf[25], 2, "color type 2 (RGB)");
});

// ── png.js: Canvas ───────────────────────────────────────────────────────
test("Canvas starts fully zeroed for a black background", () => {
  const cv = new Canvas(2, 2);
  assert.equal(cv.w, 2);
  assert.equal(cv.h, 2);
  assert.equal(cv.px.length, 2 * 2 * 3);
  assert.ok(cv.px.every((b) => b === 0), "all pixels black");
});

test("Canvas fills a non-black background color across every pixel", () => {
  const cv = new Canvas(2, 2, [10, 20, 30]);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++)
    assert.deepEqual(px(cv, x, y), [10, 20, 30]);
});

test("Canvas.set writes one pixel that reads back from .px", () => {
  const cv = new Canvas(4, 4);
  cv.set(1, 2, [255, 128, 64]);
  assert.deepEqual(px(cv, 1, 2), [255, 128, 64]);
  assert.deepEqual(px(cv, 0, 0), [0, 0, 0], "neighbors untouched");
});

test("Canvas.set ignores out-of-bounds writes without throwing", () => {
  const cv = new Canvas(3, 3);
  assert.doesNotThrow(() => {
    cv.set(-1, 0, [1, 1, 1]);
    cv.set(0, -1, [1, 1, 1]);
    cv.set(3, 0, [1, 1, 1]);
    cv.set(0, 3, [1, 1, 1]);
  });
  assert.ok(cv.px.every((b) => b === 0), "nothing was written");
});

test("Canvas.rect fills a block of pixels", () => {
  const cv = new Canvas(5, 5);
  cv.rect(1, 1, 2, 3, [9, 8, 7]);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const inside = x >= 1 && x < 3 && y >= 1 && y < 4;
    assert.deepEqual(px(cv, x, y), inside ? [9, 8, 7] : [0, 0, 0], `(${x},${y})`);
  }
});

test("Canvas.encode returns a PNG buffer with the signature", () => {
  const cv = new Canvas(2, 2, [1, 2, 3]);
  const buf = cv.encode();
  assert.ok(Buffer.isBuffer(buf));
  assert.deepEqual(buf.subarray(0, 8), PNG_SIG);
});

// ── pixel-art.js: FONT + glyph ───────────────────────────────────────────
test("FONT covers A-Z plus space and punctuation, each a 7-row 5-col glyph", () => {
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    assert.ok(FONT[ch], `FONT has ${ch}`);
  }
  for (const ch of [" ", "!", "?", "-", "/", ".", "'"]) {
    assert.ok(FONT[ch], `FONT has ${JSON.stringify(ch)}`);
  }
  for (const [ch, rows] of Object.entries(FONT)) {
    assert.equal(rows.length, 7, `${JSON.stringify(ch)} has 7 rows`);
    for (const r of rows) assert.equal(r.length, 5, `${JSON.stringify(ch)} row is 5 wide`);
  }
});

test("glyph returns the 7-row array for a known character", () => {
  assert.equal(glyph("A"), FONT.A);
  assert.equal(glyph("A").length, 7);
});

test("glyph falls back to the '!' glyph for an unknown character", () => {
  assert.equal(glyph("@"), FONT["!"]);
  assert.equal(glyph("9"), FONT["!"]);
});

test("glyph honors a font override before falling back", () => {
  const custom = ["11111", "11111", "11111", "11111", "11111", "11111", "11111"];
  const override = { Z: custom };
  assert.equal(glyph("Z", override), custom, "override wins over shared FONT");
  assert.equal(glyph("A", override), FONT.A, "missing in override → shared FONT");
});

// ── pixel-art.js: textW ──────────────────────────────────────────────────
test("textW is text.length*6*s - s (one fewer inter-glyph gap)", () => {
  assert.equal(textW("A", 1), 5);
  assert.equal(textW("AB", 1), 11);
  assert.equal(textW("ABC", 2), 34);
  assert.equal(textW("", 3), -3, "empty string keeps the literal formula");
});

// ── pixel-art.js: drawText / drawCentered ────────────────────────────────
test("drawText sets at least one expected pixel for 'I'", () => {
  const cv = new Canvas(12, 12);
  drawText(cv, "I", 0, 0, 1, [255, 255, 255]);
  // FONT.I row 0 is "11111" → (0,0) must be lit.
  assert.deepEqual(px(cv, 0, 0), [255, 255, 255]);
  // FONT.I row 1 is "00100" → middle column lit, edge column dark.
  assert.deepEqual(px(cv, 2, 1), [255, 255, 255], "stem of the I");
  assert.deepEqual(px(cv, 0, 1), [0, 0, 0], "edge below the top bar is dark");
});

test("drawText lowercases nothing visible but uppercases its input", () => {
  const lower = new Canvas(12, 12);
  const upper = new Canvas(12, 12);
  drawText(lower, "i", 0, 0, 1, [200, 100, 50]);
  drawText(upper, "I", 0, 0, 1, [200, 100, 50]);
  assert.deepEqual(lower.px, upper.px, "'i' draws the same as 'I'");
});

test("drawText scales glyph pixels by s", () => {
  const cv = new Canvas(20, 20);
  drawText(cv, "I", 0, 0, 2, [50, 60, 70]);
  // Top bar "11111" at scale 2 fills a 2×2 block at the origin.
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++)
    assert.deepEqual(px(cv, x, y), [50, 60, 70], `(${x},${y}) in scaled block`);
});

test("drawCentered horizontally centers text within the canvas width", () => {
  const w = 40;
  const cv = new Canvas(w, 12);
  drawCentered(cv, "I", 0, 1, [255, 255, 255]);
  const expectedX = Math.round((w - textW("I", 1)) / 2);
  // The top bar "11111" lights expectedX..expectedX+4; columns outside stay dark.
  assert.deepEqual(px(cv, expectedX, 0), [255, 255, 255], "left edge of centered glyph lit");
  assert.deepEqual(px(cv, expectedX - 1, 0), [0, 0, 0], "just left of glyph is dark");
});

// ── pixel-art.js: noEntry ────────────────────────────────────────────────
test("noEntry draws a ring and crossbar without throwing and sets pixels", () => {
  const cv = new Canvas(40, 40);
  assert.doesNotThrow(() => noEntry(cv, 20, 20, 12, [200, 0, 0], [255, 255, 255]));
  // The crossbar runs through the center — center pixel must be the bar color.
  assert.deepEqual(px(cv, 20, 20), [255, 255, 255], "center is crossbar");
  // Something was drawn somewhere besides the all-black background.
  assert.ok(cv.px.some((b) => b !== 0), "ring/bar set pixels");
});

test("noEntry near a canvas edge clips instead of throwing", () => {
  const cv = new Canvas(10, 10);
  assert.doesNotThrow(() => noEntry(cv, 0, 0, 8, [1, 2, 3], [4, 5, 6]));
});

// ── pixel-art.js: border ─────────────────────────────────────────────────
test("border draws a single-color frame and sets the outer edge pixels", () => {
  const cv = new Canvas(6, 6);
  border(cv, 1, [7, 8, 9]);
  // Every pixel on the outer ring is the border color.
  for (let x = 0; x < 6; x++) {
    assert.deepEqual(px(cv, x, 0), [7, 8, 9], `top (${x},0)`);
    assert.deepEqual(px(cv, x, 5), [7, 8, 9], `bottom (${x},5)`);
  }
  for (let y = 0; y < 6; y++) {
    assert.deepEqual(px(cv, 0, y), [7, 8, 9], `left (0,${y})`);
    assert.deepEqual(px(cv, 5, y), [7, 8, 9], `right (5,${y})`);
  }
  // The interior stays untouched (black).
  assert.deepEqual(px(cv, 2, 2), [0, 0, 0], "interior untouched");
});

test("border cycles a multi-color palette per layer", () => {
  const cv = new Canvas(8, 8);
  border(cv, 2, [[10, 0, 0], [0, 20, 0]]);
  assert.deepEqual(px(cv, 0, 0), [10, 0, 0], "layer 0 → first color");
  assert.deepEqual(px(cv, 1, 1), [0, 20, 0], "layer 1 → second color");
});

// ── img.js: pngToAnsi round-trip ─────────────────────────────────────────
test("pngToAnsi round-trips a solid-red PNG into truecolor half-blocks", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const cv = new Canvas(6, 6, [255, 0, 0]);
  const file = box.file("red.png");
  // Persist the encoded PNG to a real tmp file, then decode it back.
  writeFileSync(file, cv.encode());
  const out = pngToAnsi(file, { cols: 6 });
  assert.ok(out, "non-null render");
  assert.ok(out.includes("▀"), "uses the half-block character");
  assert.ok(out.includes("\x1b[38;2;255;0;0m"), "truecolor red foreground");
  assert.ok(out.includes("\x1b[48;2;255;0;0m"), "truecolor red background");
});

test("pngToAnsi returns null for a file that cannot be decoded", () => {
  assert.equal(pngToAnsi("/no/such/file.png"), null);
  assert.equal(pngToAnsi("/no/such/file.png", { cols: 20 }), null);
});

test("pngToAnsi returns null for a real file that is not a valid PNG", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const file = box.file("bogus.png");
  writeFileSync(file, Buffer.from("this is not a png"));
  assert.equal(pngToAnsi(file), null);
});
