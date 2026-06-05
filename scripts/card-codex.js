#!/usr/bin/env node
// 🚫 Codex / Sam denial keepsake → art/out-codex-sam.png
// Built on the shared Canvas + 5×7 font from lib/door/art/pixel-art.js, with local
// helpers below for glow/ring/disc/frame/shadows (codex-specific render math).
// A dark, OpenAI-teal-accented, red-denial card: our tokens stay right here.
import { writeFileSync, mkdirSync } from "node:fs";
import { Canvas, drawCentered, drawText, textW } from "../lib/door/art/pixel-art.js";

const W = 720, H = 480;

// ── palette ─────────────────────────────────────────────────────────────
const RED        = [255, 64, 56];
const RED_DEEP   = [120, 22, 20];
const RED_GLOW   = [60, 18, 18];
const SIGN       = [238, 242, 245];
const SIGN_DIM   = [150, 158, 165];
const TEAL       = [16, 185, 142];
const TEAL_DEEP  = [9, 96, 78];
const TEAL_GLOW  = [12, 50, 44];
const INK        = [8, 11, 13];

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix  = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const cv = new Canvas(W, H, INK);

// ── 1. vertical background gradient (deep teal-tinged ink) ──────────────
// Top a touch lighter & teal-leaning, bottom near-black, with a faint
// vignette so the centre glows. Per-row color set via cv.set.
const topCol = [13, 22, 24];
const midCol = [9, 14, 16];
const botCol = [6, 9, 11];
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const base = t < 0.5 ? mix(topCol, midCol, t * 2) : mix(midCol, botCol, (t - 0.5) * 2);
  for (let x = 0; x < W; x++) {
    // horizontal vignette: darken toward the left/right edges
    const dx = (x - W / 2) / (W / 2);
    const vig = 1 - 0.22 * dx * dx;
    cv.set(x, y, [
      clamp(Math.round(base[0] * vig), 0, 255),
      clamp(Math.round(base[1] * vig), 0, 255),
      clamp(Math.round(base[2] * vig), 0, 255),
    ]);
  }
}

// ── 2. faint horizontal scanlines for a CRT keepsake feel ───────────────
for (let y = 0; y < H; y += 3) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    cv.px[i] = Math.round(cv.px[i] * 0.86);
    cv.px[i + 1] = Math.round(cv.px[i + 1] * 0.86);
    cv.px[i + 2] = Math.round(cv.px[i + 2] * 0.86);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────
// additive soft glow: brighten existing pixels toward `c` with radial falloff
function glow(cx, cy, radius, c, strength = 0.6) {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || x >= W) continue;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 > r2) continue;
      const f = (1 - Math.sqrt(d2) / radius) ** 2 * strength;
      const i = (y * W + x) * 3;
      cv.px[i]     = clamp(Math.round(cv.px[i]     + (c[0] - cv.px[i])     * f), 0, 255);
      cv.px[i + 1] = clamp(Math.round(cv.px[i + 1] + (c[1] - cv.px[i + 1]) * f), 0, 255);
      cv.px[i + 2] = clamp(Math.round(cv.px[i + 2] + (c[2] - cv.px[i + 2]) * f), 0, 255);
    }
  }
}

// text with a soft drop shadow drawn first, then the face on top
function textShadow(text, y, s, color, shadow = INK, off = Math.max(2, Math.round(s * 0.5))) {
  const x = Math.round((W - textW(text, s)) / 2);
  drawText(cv, text, x + off, y + off, s, shadow);
  drawText(cv, text, x, y, s, color);
}

// crisp anti-aliased-ish filled disc / ring using coverage thresholds
function ring(cx, cy, rOuter, rInner, color) {
  for (let y = -rOuter; y <= rOuter; y++) {
    for (let x = -rOuter; x <= rOuter; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= rOuter + 0.5 && d >= rInner - 0.5) cv.set(cx + x, cy + y, color);
    }
  }
}
function disc(cx, cy, r, color) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r + 0.5) cv.set(cx + x, cy + y, color);
}

// ── 3. multi-layer border: teal outer slab + inner accent line ──────────
function frame() {
  // outer thick teal band with a gradient down its thickness
  const T = 7;
  for (let i = 0; i < T; i++) {
    const c = mix(TEAL, TEAL_DEEP, i / (T - 1));
    cv.rect(i, i, W - 2 * i, 1, c);
    cv.rect(i, H - 1 - i, W - 2 * i, 1, c);
    cv.rect(i, i, 1, H - 2 * i, c);
    cv.rect(W - 1 - i, i, 1, H - 2 * i, c);
  }
  // dark gap
  const g = T + 3;
  cv.rect(g, g, W - 2 * g, 1, INK);
  cv.rect(g, H - 1 - g, W - 2 * g, 1, INK);
  cv.rect(g, g, 1, H - 2 * g, INK);
  cv.rect(W - 1 - g, g, 1, H - 2 * g, INK);
  // thin bright teal accent line
  const a = T + 5;
  cv.rect(a, a, W - 2 * a, 1, TEAL);
  cv.rect(a, H - 1 - a, W - 2 * a, 1, TEAL);
  cv.rect(a, a, 1, H - 2 * a, TEAL);
  cv.rect(W - 1 - a, a, 1, H - 2 * a, TEAL);
}

// corner L-brackets in bright teal for a "framed plate" look
function corners() {
  const m = 18, len = 30, th = 3, c = TEAL, cd = TEAL_DEEP;
  const L = (x, y, sx, sy) => {
    // shadow then bright
    cv.rect(x + 1, y + 1, len * sx > 0 ? len : 1, th, cd);
    cv.rect(x + 1, y + 1, th, len * sy > 0 ? len : 1, cd);
    for (let k = 0; k < len; k++) {
      cv.rect(x + sx * k, y, 1, th, c);
      cv.rect(x, y + sy * k, th, 1, c);
    }
  };
  L(m, m, 1, 1);
  L(W - 1 - m, m, -1, 1);
  L(m, H - 1 - m, 1, -1);
  L(W - 1 - m, H - 1 - m, -1, -1);
}

frame();
corners();

// ── 4. the no-entry emblem: glow → red disc → white ring → crossbar ─────
const eCx = W / 2, eCy = 96, eR = 46;
glow(eCx, eCy, eR + 30, RED, 0.42);          // outer red halo
glow(eCx, eCy, eR + 14, RED, 0.28);          // tighter hot core
ring(eCx, eCy, eR, eR - 9, SIGN);            // white outer ring
ring(eCx, eCy, eR - 9, eR - 12, RED_DEEP);   // thin inner shadow edge
disc(eCx, eCy, eR - 12, RED);                // red field
// glossy top highlight on the disc
for (let y = -eR + 14; y < -6; y++)
  for (let x = -eR + 16; x <= eR - 16; x++) {
    if (x * x + y * y <= (eR - 12) * (eR - 12)) {
      const i = ((eCy + y) * W + (eCx + x)) * 3;
      cv.px[i] = clamp(cv.px[i] + 26, 0, 255);
      cv.px[i + 1] = clamp(cv.px[i + 1] + 14, 0, 255);
      cv.px[i + 2] = clamp(cv.px[i + 2] + 14, 0, 255);
    }
  }
// crossbar (white slab with a subtle shadow under it)
const barW = 2 * (eR - 16), barH = 12;
cv.rect(eCx - barW / 2, eCy - barH / 2 + 2, barW, barH, [180, 30, 26]); // shadow
cv.rect(eCx - barW / 2, eCy - barH / 2, barW, barH, SIGN);             // bar
// bar bevel
cv.rect(eCx - barW / 2, eCy - barH / 2, barW, 2, [255, 255, 255]);

// ── 5. headline: DATA HEIST DENIED (red on dark, glowing) ───────────────
const hY = 164;
glow(W / 2, hY + 14, 150, RED, 0.16);
textShadow("DATA HEIST DENIED", hY, 4, RED, RED_GLOW, 3);

// thin teal divider rule flanking a label — used both above & below SAM
function rule(y, gap = 64, half = 150) {
  const cx = W / 2;
  for (let i = 0; i < half; i++) {
    const t = i / half;
    const c = mix(TEAL_GLOW, TEAL, Math.min(1, t * 1.6));
    cv.set(cx - gap - i, y, c);
    cv.set(cx + gap + i, y, c);
  }
  // little teal diamonds at the inner ends
  for (const sx of [-1, 1]) {
    const bx = cx + sx * gap;
    cv.set(bx, y - 1, TEAL); cv.set(bx, y + 1, TEAL);
    cv.set(bx - 1, y, TEAL); cv.set(bx + 1, y, TEAL); cv.set(bx, y, TEAL);
  }
}

// ── 6. SAM (large, clean white with shadow), framed by two teal rules ───
const samY = 206;        // SAM spans samY .. samY+35 (scale 5 → 35px tall)
rule(samY - 8, 50, 130); // rule comfortably above the caps
rule(samY + 41, 50, 130);// rule comfortably below the baseline
textShadow("SAM", samY, 5, SIGN, [4, 6, 7], 3);

// ── 7. punchline slab: NICE TRY SAM (red slab, glowing, beveled) ────────
const pScale = 8;
const pTxt = "NICE TRY SAM";
const pw = textW(pTxt, pScale);
const slabX = Math.round((W - pw) / 2) - 16;
const slabY = 280;
const slabW = pw + 32;
const slabH = 7 * pScale + 24;

glow(W / 2, slabY + slabH / 2, slabW / 2 + 40, RED, 0.4); // red halo behind slab
// drop shadow under slab
cv.rect(slabX + 5, slabY + 6, slabW, slabH, [0, 0, 0]);
// slab body with a vertical gradient (lighter top → deeper bottom)
for (let dy = 0; dy < slabH; dy++) {
  const c = mix([255, 90, 80], RED_DEEP, dy / (slabH - 1));
  cv.rect(slabX, slabY + dy, slabW, 1, c);
}
// bevels: bright top/left, dark bottom/right
cv.rect(slabX, slabY, slabW, 2, [255, 170, 160]);
cv.rect(slabX, slabY, 2, slabH, [255, 150, 140]);
cv.rect(slabX, slabY + slabH - 2, slabW, 2, [90, 14, 12]);
cv.rect(slabX + slabW - 2, slabY, 2, slabH, [90, 14, 12]);
// punchline text: ink, with a faint light "emboss" highlight 1px up-left
drawCentered(cv, pTxt, slabY + 12 + 1, pScale, [150, 24, 20]); // inner shadow
drawCentered(cv, pTxt, slabY + 12, pScale, INK);

// ── 8. footer: OUR TOKENS STAY RIGHT HERE (dim teal-white) ──────────────
const fY = 408;
// thin teal underline accent above footer
const ulW = 280;
cv.rect((W - ulW) / 2, fY - 14, ulW, 1, TEAL_DEEP);
cv.rect((W - ulW) / 2 + ulW / 2 - 30, fY - 14, 60, 1, TEAL);
textShadow("OUR TOKENS STAY RIGHT HERE", fY, 3, SIGN_DIM, [4, 8, 8], 2);
// tiny teal end-caps on the footer line for symmetry
for (const sx of [-1, 1]) {
  const bx = W / 2 + sx * (ulW / 2 + 8);
  cv.set(bx, fY - 14, TEAL); cv.set(bx, fY - 15, TEAL); cv.set(bx, fY - 13, TEAL);
}

cv.antialias(2);   // smooth the bitmap-font / hard-edge jaggies — clean, not blocky
mkdirSync("art", { recursive: true });
writeFileSync("art/out-codex-sam.png", cv.encode());
console.log("🖼️  art/out-codex-sam.png");
