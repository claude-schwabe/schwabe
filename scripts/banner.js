#!/usr/bin/env node
// Generate the README hero banner → art/banner.png
// Built on the shared Canvas + 5×7 font from lib/door/art/pixel-art.js.
import { writeFileSync, mkdirSync } from "node:fs";
import { Canvas, drawText, drawCentered, textW } from "../lib/door/art/pixel-art.js";

const W = 1280, H = 440;
const cv = new Canvas(W, H, [10, 8, 7]);

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ── ember background: dark top, warm glowing bottom, centre vignette ──────
const top = [10, 8, 7], midd = [26, 13, 8], bot = [70, 24, 9];
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const base = t < 0.6 ? mix(top, midd, t / 0.6) : mix(midd, bot, (t - 0.6) / 0.4);
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const vig = 1 - 0.28 * dx * dx;
    cv.set(x, y, [Math.round(base[0] * vig), Math.round(base[1] * vig), Math.round(base[2] * vig)]);
  }
}

// ── flames licking up from the bottom edge ───────────────────────────────
for (let fx = 16; fx < W - 16; fx += 16) {
  const h = 26 + Math.round(40 * Math.abs(Math.sin(fx * 0.07) + 0.4 * Math.sin(fx * 0.21)));
  for (let yy = 0; yy < h; yy++) {
    const t = yy / h;
    const w = Math.max(1, Math.round(10 * (1 - t)));      // taper to a point
    const c = mix([255, 210, 70], [190, 40, 18], t);
    cv.rect(fx + ((10 - w) >> 1), H - 1 - yy, w, 1, c);
  }
}

// ── top flash: the new apex model ────────────────────────────────────────
// (callback to the bouncer's "we don't serve noobs" — but we DO serve Fable.)
drawCentered(cv, "NOW ALSO SERVING FABLE FIVE", 34, 4, [86, 196, 222]);

// ── big flame-coloured title ─────────────────────────────────────────────
const FLAME = [[255, 70, 40], [255, 120, 34], [255, 168, 36], [255, 214, 70], [255, 150, 32], [255, 96, 34], [255, 188, 44]];
const title = "SCHWABE", ts = 14, ty = 110;
let x = Math.round((W - textW(title, ts)) / 2);
[...title].forEach((ch, i) => {
  drawText(cv, ch, x + 5, ty + 6, ts, [0, 0, 0]);       // drop shadow
  drawText(cv, ch, x, ty, ts, FLAME[i % FLAME.length]);
  x += 6 * ts;
});

// ── subtitle + funny tagline ─────────────────────────────────────────────
const subY = ty + 7 * ts + 30;
drawCentered(cv, "THE TOKEN BURNER", subY, 5, [235, 188, 130]);
drawCentered(cv, "TOO THRIFTY TO LET A TOKEN EXPIRE", subY + 54, 3, [168, 132, 96]);

mkdirSync("art", { recursive: true });
writeFileSync("art/banner.png", cv.encode());
console.log("🖼️  art/banner.png  (" + W + "x" + H + ")");
