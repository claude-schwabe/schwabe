#!/usr/bin/env node
// 🚫 Gemini / Google "data harvest denied" keepsake → art/out-gemini-google.png
// Composed from the shared pixel-art primitives in lib/door/art/pixel-art.js (read-only),
// with local helpers here for shadows, glows, gradients and a denied-scraper motif.
import { writeFileSync, mkdirSync } from "node:fs";
import { Canvas, drawText, textW, FONT } from "../lib/door/art/pixel-art.js";

// ── palette ─────────────────────────────────────────────────────────────
const W = 720, H = 480;
const BG = [248, 249, 252];          // clean near-white
const INK = [32, 33, 36];            // Google "grey 900" slab text
const RED = [234, 67, 53];           // Google red — the denial color
const BLUE = [66, 133, 244];
const YELLOW = [251, 188, 5];
const GREEN = [52, 168, 83];
const GOOGLE = [BLUE, RED, YELLOW, GREEN];

// ── color helpers ───────────────────────────────────────────────────────
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
// mix a toward b by t (0..1)
const mix = (a, b, t) => [
  clamp(a[0] + (b[0] - a[0]) * t),
  clamp(a[1] + (b[1] - a[1]) * t),
  clamp(a[2] + (b[2] - a[2]) * t),
];
const lighten = (c, t) => mix(c, [255, 255, 255], t);
const darken = (c, t) => mix(c, [0, 0, 0], t);

// read a pixel (clamped to edges)
function getPx(cv, x, y) {
  x = Math.max(0, Math.min(cv.w - 1, x));
  y = Math.max(0, Math.min(cv.h - 1, y));
  const i = (y * cv.w + x) * 3;
  return [cv.px[i], cv.px[i + 1], cv.px[i + 2]];
}
// alpha-blend color c over existing pixel
function blend(cv, x, y, c, a) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h || a <= 0) return;
  if (a >= 1) return cv.set(x, y, c);
  cv.set(x, y, mix(getPx(cv, x, y), c, a));
}
function blendRect(cv, x, y, w, h, c, a) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) blend(cv, x + dx, y + dy, c, a);
}

// ── custom glyphs (local only — never touches shared FONT) ──────────────
// A comma so the footer can breathe; a filled dot for accents.
const LOCAL = {
  ...FONT,
  ",": ["00000", "00000", "00000", "00000", "00100", "00100", "01000"],
};

// ── soft glow halo: concentric translucent rings of `color` around (cx,cy)
function glow(cv, cx, cy, r0, r1, color, maxA) {
  for (let y = cy - r1; y <= cy + r1; y++) {
    for (let x = cx - r1; x <= cx + r1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r0 || d > r1) continue;
      const t = 1 - (d - r0) / (r1 - r0); // 1 at inner edge → 0 outward
      blend(cv, x, y, color, maxA * t * t);
    }
  }
}

// filled disc / ring helpers
function disc(cv, cx, cy, r, color) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r) cv.set(cx + x, cy + y, color);
}
function ring(cv, cx, cy, rOuter, rInner, color) {
  for (let y = -rOuter; y <= rOuter; y++) for (let x = -rOuter; x <= rOuter; x++) {
    const d2 = x * x + y * y;
    if (d2 <= rOuter * rOuter && d2 >= rInner * rInner) cv.set(cx + x, cy + y, color);
  }
}

// ── text with a soft drop shadow ────────────────────────────────────────
function shadowText(cv, text, x, y, s, color, font = LOCAL, off = null, sa = 0.28) {
  const o = off ?? Math.max(2, Math.round(s * 0.6));
  // soft shadow: two offset passes, lighter then darker
  drawTextA(cv, text, x + o, y + o, s, darken(color, 0.55), 0.16, font);
  drawTextA(cv, text, x + Math.round(o * 0.6), y + Math.round(o * 0.6), s, darken(color, 0.6), sa, font);
  drawText(cv, text, x, y, s, color, font);
}
function centeredShadow(cv, text, y, s, color, font = LOCAL, off = null, sa = 0.28) {
  const x = Math.round((cv.w - textW(text, s)) / 2);
  shadowText(cv, text, x, y, s, color, font, off, sa);
}
// drawText but alpha-blended (for soft shadows)
function drawTextA(cv, text, x, y, s, c, a, font = LOCAL) {
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    const g = font[ch] || font["!"];
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++)
      if (g[row][col] === "1") blendRect(cv, cx + col * s, y + row * s, s, s, c, a);
    cx += 6 * s;
  }
}

// ════════════════════════════════════════════════════════════════════════
const cv = new Canvas(W, H, BG);

// ── background: faint diagonal Google-gradient wash + corner glows ──────
// very subtle so text stays crisp
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = (x + y) / (W + H);           // 0..1 across diagonal
    // pick a gentle hue from the brand wheel, extremely diluted
    const hue = mix(BLUE, GREEN, t);
    blend(cv, x, y, hue, 0.05);
  }
}
// soft brand-colored corner accents
glow(cv, 0, 0, 0, 200, BLUE, 0.10);
glow(cv, W, 0, 0, 200, RED, 0.10);
glow(cv, 0, H, 0, 200, YELLOW, 0.10);
glow(cv, W, H, 0, 200, GREEN, 0.10);

// ── classy layered four-color border ────────────────────────────────────
// Outer: thin dark frame for definition.
function frameRect(cv, x, y, w, h, c) {
  cv.rect(x, y, w, 1, c); cv.rect(x, y + h - 1, w, 1, c);
  cv.rect(x, y, 1, h, c); cv.rect(x + w - 1, y, 1, h, c);
}
// 1px outer ink frame
frameRect(cv, 4, 4, W - 8, H - 8, darken(INK, 0.1));
// thick four-color band, split into segments per edge for a clean look
(function googleBorder() {
  const m = 7;             // inset
  const t = 10;            // band thickness
  const seg = 4;           // colors
  // top & bottom edges segmented horizontally
  for (let x = m; x < W - m; x++) {
    const c = GOOGLE[Math.floor(((x - m) / (W - 2 * m)) * seg) % seg];
    for (let i = 0; i < t; i++) {
      blend(cv, x, m + i, mix(c, lighten(c, 0.15), i / t), 1);
      blend(cv, x, H - 1 - m - i, mix(c, darken(c, 0.12), i / t), 1);
    }
  }
  // left & right edges segmented vertically
  for (let y = m; y < H - m; y++) {
    const c = GOOGLE[Math.floor(((y - m) / (H - 2 * m)) * seg) % seg];
    for (let i = 0; i < t; i++) {
      blend(cv, m + i, y, mix(c, lighten(c, 0.15), i / t), 1);
      blend(cv, W - 1 - m - i, y, mix(c, darken(c, 0.12), i / t), 1);
    }
  }
  // inner thin ink frame to separate band from content (drawn first so the
  // corner squares sit cleanly on top of it)
  frameRect(cv, m + t + 2, m + t + 2, W - 2 * (m + t + 2), H - 2 * (m + t + 2), mix(BG, INK, 0.25));
  // corner squares with the four colors for a tidy, intentional finish
  const cs = t + 6;
  const corners = [[m, m, BLUE], [W - m - cs, m, RED], [m, H - m - cs, YELLOW], [W - m - cs, H - m - cs, GREEN]];
  for (const [cx, cy, c] of corners) {
    cv.rect(cx, cy, cs, cs, c);
    cv.rect(cx + 3, cy + 3, cs - 6, cs - 6, lighten(c, 0.2));
    cv.rect(cx + 5, cy + 5, cs - 10, cs - 10, c);
  }
})();

// ── the denied scraper emblem ───────────────────────────────────────────
// A red no-entry sign with a soft halo; behind it, a faint magnifying glass
// ("scraper") motif being crossed out.
(function emblem() {
  const cx = W / 2, cy = 96, R = 48;

  // red halo glow behind the sign
  glow(cv, cx, cy, R - 4, R + 30, RED, 0.22);

  // faint magnifying-glass "scraper" being denied, drawn behind the sign
  const mgx = cx + 26, mgy = cy + 24, mr = 22;
  ring(cv, mgx, mgy, mr, mr - 5, mix(BG, INK, 0.35));   // lens rim (muted)
  ring(cv, mgx, mgy, mr - 5, mr - 7, mix(BG, BLUE, 0.4)); // faint blue glint
  // handle
  for (let i = 0; i < 26; i++) {
    const hx = mgx + Math.round(mr * 0.7) + Math.round(i * 0.7);
    const hy = mgy + Math.round(mr * 0.7) + i;
    blendRect(cv, hx, hy, 5, 5, mix(BG, INK, 0.35), 1);
  }

  // ── the no-entry sign itself: crisp filled ring + crossbar, with shading
  // shadow underneath
  disc(cv, cx + 4, cy + 5, R, mix(BG, INK, 0.18));
  // outer red ring with a subtle vertical light→dark gradient
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    const d2 = x * x + y * y;
    if (d2 <= R * R && d2 >= (R - 11) * (R - 11)) {
      const shade = (y + R) / (2 * R);           // 0 top → 1 bottom
      cv.set(cx + x, cy + y, mix(lighten(RED, 0.18), darken(RED, 0.18), shade));
    }
  }
  // white inner face
  disc(cv, cx, cy, R - 12, [255, 255, 255]);
  // soft inner shadow ring for depth
  ring(cv, cx, cy, R - 12, R - 14, mix([255, 255, 255], INK, 0.08));
  // crossbar with gradient + highlight
  const bh = Math.round(R * 0.34), bw = 2 * (R - 14);
  for (let dy = 0; dy < bh; dy++) {
    const shade = dy / bh;
    const c = mix(lighten(RED, 0.12), darken(RED, 0.2), shade);
    cv.rect(cx - (R - 14), cy - Math.round(bh / 2) + dy, bw, 1, c);
  }
  // crossbar top highlight
  cv.rect(cx - (R - 14), cy - Math.round(bh / 2), bw, 1, lighten(RED, 0.35));
  // tiny specular highlight on upper-left of ring
  blendRect(cv, cx - Math.round(R * 0.62), cy - Math.round(R * 0.62), 6, 3, [255, 255, 255], 0.5);
})();

// ── headline: "DATA HARVEST DENIED" ─────────────────────────────────────
centeredShadow(cv, "DATA HARVEST DENIED", 168, 4, RED, LOCAL, 3, 0.3);
// thin accent rule under the headline (four-color dashes)
(function rule(y) {
  const total = 360, x0 = Math.round((W - total) / 2);
  for (let i = 0; i < total; i++) {
    const c = GOOGLE[Math.floor((i / total) * 4) % 4];
    if (i % 12 < 8) blend(cv, x0 + i, y, c, 0.85), blend(cv, x0 + i, y + 1, darken(c, 0.1), 0.7);
  }
})(204);

// ── subhead: "GEMINI / GOOGLE" in ink ───────────────────────────────────
centeredShadow(cv, "GEMINI / GOOGLE", 224, 5, INK, LOCAL, 3, 0.26);

// ── punchline slab: "NO SCRAPING" ───────────────────────────────────────
(function punchline() {
  const s = 8, txt = "NO SCRAPING";
  const tw = textW(txt, s);
  const padX = 22, padY = 14;
  const bw = tw + padX * 2;
  const bh = 7 * s + padY * 2;
  const bx = Math.round((W - bw) / 2);
  const by = 300;

  // red glow behind the whole slab
  for (let i = 1; i <= 14; i++) {
    blendRect(cv, bx - i, by - i, bw + 2 * i, bh + 2 * i, RED, 0.05 * (1 - i / 16));
  }
  // drop shadow
  blendRect(cv, bx + 6, by + 7, bw, bh, mix(BG, INK, 0.3), 0.55);
  // slab body with vertical gradient
  for (let dy = 0; dy < bh; dy++) {
    const c = mix(lighten(RED, 0.1), darken(RED, 0.22), dy / bh);
    cv.rect(bx, by + dy, bw, 1, c);
  }
  // top highlight + bottom shade lines
  cv.rect(bx, by, bw, 2, lighten(RED, 0.3));
  cv.rect(bx, by + bh - 2, bw, 2, darken(RED, 0.3));
  // inset border
  frameRect(cv, bx + 3, by + 3, bw - 6, bh - 6, lighten(RED, 0.25));

  // the text: white with a faint dark inner shadow for crispness
  const tx = Math.round((W - tw) / 2);
  const ty = by + padY;
  drawTextA(cv, txt, tx + 2, ty + 2, s, darken(RED, 0.45), 0.4, LOCAL);
  drawText(cv, txt, tx, ty, s, [255, 255, 255], LOCAL);
})();

// ── footer: "GO INDEX SOMEONE ELSE" ─────────────────────────────────────
centeredShadow(cv, "GO INDEX SOMEONE ELSE", 416, 3, mix(INK, BG, 0.15), LOCAL, 2, 0.22);
// little brand dots flanking the footer
(function dots(y) {
  const positions = [[150, BLUE], [W - 150, GREEN]];
  for (const [x, c] of positions) {
    disc(cv, x, y, 4, c);
    blend(cv, x - 1, y - 1, [255, 255, 255], 0.5);
  }
})(423);

cv.antialias(2);   // smooth the bitmap-font / hard-edge jaggies — clean, not blocky
mkdirSync("art", { recursive: true });
writeFileSync("art/out-gemini-google.png", cv.encode());
console.log("🖼️  art/out-gemini-google.png");
