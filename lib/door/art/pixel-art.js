// Shared pixel-art primitives for the denial cards. The PNG encoder + Canvas
// live in png.js; this adds a 5×7 font and text/icon drawing on top, so each
// card script (scripts/card-*.js) can compose its own art from these pieces.

import { Canvas } from "./png.js";
export { Canvas };

// 5×7 uppercase pixel font. Pass a `font` override to drawText to add glyphs
// locally (a card can extend it without touching this shared table).
export const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00010", "00100", "00100", "00000", "00100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00000", "00100"],
  "'": ["00100", "00100", "00100", "00000", "00000", "00000", "00000"],
};

export const glyph = (c, font = FONT) => font[c] || FONT[c] || FONT["!"];
export const textW = (text, s) => text.length * 6 * s - s;

export function drawText(cv, text, x, y, s, c, font = FONT) {
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    const g = glyph(ch, font);
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++)
      if (g[row][col] === "1") cv.rect(cx + col * s, y + row * s, s, s, c);
    cx += 6 * s;
  }
}

export const drawCentered = (cv, text, y, s, c, font = FONT) =>
  drawText(cv, text, Math.round((cv.w - textW(text, s)) / 2), y, s, c, font);

// A chunky pixel no-entry sign (filled ring + crossbar).
export function noEntry(cv, cx, cy, r, ring, bar) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.sqrt(x * x + y * y);
    if (d <= r && d >= r - Math.max(3, r * 0.28)) cv.set(cx + x, cy + y, ring);
  }
  cv.rect(cx - r + 2, cy - Math.round(r * 0.18), 2 * r - 4, Math.round(r * 0.36), bar);
}

// Even-odd ring border; `colors` may be one [r,g,b] or an array cycled per layer.
export function border(cv, thickness, colors) {
  const ring = Array.isArray(colors[0]) ? colors : [colors];
  for (let i = 0; i < thickness; i++) {
    const c = ring[i % ring.length];
    cv.rect(i, i, cv.w - 2 * i, 1, c); cv.rect(i, cv.h - 1 - i, cv.w - 2 * i, 1, c);
    cv.rect(i, i, 1, cv.h - 2 * i, c); cv.rect(cv.w - 1 - i, i, 1, cv.h - 2 * i, c);
  }
}
