// Decode a truecolor PNG and render it as ANSI half-blocks, so an image can
// appear inside the terminal (each text cell = two stacked pixels via ▀ with
// fg = top, bg = bottom). Area-averages each source region so it stays smooth at
// terminal resolution instead of coarse/blocky. Supports 8-bit colortype 2 (RGB)
// and 6 (RGBA), non-interlaced — which is exactly what our cards are.

import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) throw new Error("unsupported png");
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let val;
      switch (f) {
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: val = v + paeth(a, b, c); break;
        default: val = v;
      }
      out[y * stride + x] = val & 255;
    }
  }
  return { width, height, ch, data: out };
}

// Render a PNG file to an ANSI string, as large (and therefore as sharp) as the
// terminal allows. `cols` is the column budget; optional `rows` is the text-row
// budget — the image is fit within BOTH, preserving aspect, at the highest cell
// count that still fits (bigger = less pixelated). Returns null if the file can't
// be decoded (caller falls back to printing the path).
export function pngToAnsi(path, { cols = 84, rows = Infinity } = {}) {
  let img;
  try { img = decodePNG(readFileSync(path)); } catch { return null; }
  const { width, height, ch, data } = img;
  // Each text row stacks two source-pixel rows (▀), so textRows ≈ height·outCols/(2·width).
  // Invert that to cap columns by the row budget, so the card never overflows the screen.
  let outCols = Math.min(cols, width);
  if (Number.isFinite(rows)) outCols = Math.min(outCols, Math.floor((rows * 2 * width) / height));
  outCols = Math.max(8, outCols);
  const cell = width / outCols;                       // source px per column (and per half-row)
  const halfRows = Math.max(2, Math.round(height / cell));

  const avg = (x0, y0) => {
    let r = 0, g = 0, b = 0, n = 0;
    const xs = Math.max(0, Math.floor(x0)), xe = Math.min(width, Math.ceil(x0 + cell));
    const ys = Math.max(0, Math.floor(y0)), ye = Math.min(height, Math.ceil(y0 + cell));
    for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) { const i = (y * width + x) * ch; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    n = n || 1; return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };

  const lines = [];
  for (let ry = 0; ry < halfRows; ry += 2) {
    let line = "";
    for (let cx = 0; cx < outCols; cx++) {
      const t = avg(cx * cell, ry * cell);
      const b = avg(cx * cell, (ry + 1) * cell);
      line += `\x1b[38;2;${t[0]};${t[1]};${t[2]}m\x1b[48;2;${b[0]};${b[1]};${b[2]}m▀`;
    }
    lines.push("  " + line + "\x1b[0m");
  }
  return lines.join("\n");
}
