// From-scratch truecolor PNG encoder — Node's zlib only, no deps. Shared by the
// denial-card generators (scripts/pixel-card.js → scripts/card-*.js, via
// pixel-art.js). A PNG is just IHDR + zlib-deflated scanlines + IEND.

import zlib from "node:zlib";

// ── CRC-32 (PNG chunk checksum) ─────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// Encode an RGB buffer (length width*height*3) into a truecolor PNG Buffer.
export function encodePNG({ width, height, rgb }) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter type 0 (none)
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit, color type 2 (RGB)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── tiny RGB drawing canvas ─────────────────────────────────────────────
// A mutable w*h*3 pixel buffer with a few primitives. `encode()` → PNG Buffer.
export class Canvas {
  constructor(w, h, bg = [0, 0, 0]) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    if (bg[0] || bg[1] || bg[2]) for (let i = 0; i < w * h; i++) { this.px[i * 3] = bg[0]; this.px[i * 3 + 1] = bg[1]; this.px[i * 3 + 2] = bg[2]; }
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3; this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  }
  rect(x, y, w, h, c) { for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, c); }

  // Anti-alias: a separable [1,2,1]/4 blur applied `passes` times. The cards are
  // drawn with a hard-edged 5×7 bitmap font and hard circles, which read as jagged
  // pixel-art; this gives every edge a smooth sub-pixel falloff (flat fills stay
  // flat) so the keepsake looks clean instead of blocky. Call once before encode().
  antialias(passes = 1) {
    const { w, h, px } = this;
    const blur1d = (src, dst, stride, n, lineStep, lineCount) => {
      for (let l = 0; l < lineCount; l++) {
        const base = l * lineStep;
        for (let i = 0; i < n; i++) {
          const o = base + i * stride;
          const a = i > 0 ? o - stride : o, b = i < n - 1 ? o + stride : o;
          dst[o] = (src[a] + 2 * src[o] + src[b]) >> 2;
          dst[o + 1] = (src[a + 1] + 2 * src[o + 1] + src[b + 1]) >> 2;
          dst[o + 2] = (src[a + 2] + 2 * src[o + 2] + src[b + 2]) >> 2;
        }
      }
    };
    for (let p = 0; p < passes; p++) {
      const tmp = Buffer.from(px);
      blur1d(tmp, px, 3, w, w * 3, h);          // horizontal: each row, step 3
      const tmp2 = Buffer.from(px);
      blur1d(tmp2, px, w * 3, h, 3, w);          // vertical: each column, step w*3
    }
    return this;
  }

  encode() { return encodePNG({ width: this.w, height: this.h, rgb: this.px }); }
}
