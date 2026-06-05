// Reusable terminal widgets in the btop/htop idiom: heat-graded meters, block
// sparklines, and rounded boxes that stay aligned even with ANSI inside them.
// Renderers compose these; none of them touch the screen directly.

import { C, RESET, gradient, clamp, fit, visLen, paint } from "../core/util.js";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const spinner = (i) => SPIN[i % SPIN.length];

const BARS = "▁▂▃▄▅▆▇█".split("");

// btop-style braille-ish bar meter: filled cells heat from green→red.
export function meter(frac, width) {
  frac = clamp(frac, 0, 1);
  const filled = Math.round(frac * width);
  let s = "";
  for (let i = 0; i < width; i++) {
    if (i < filled) s += gradient(i / Math.max(1, width - 1)) + "▮";
    else s += C.gray + "▯";
  }
  return s + RESET;
}

// Block sparkline; auto-scales to its own max.
export function sparkline(values, width) {
  const v = values.slice(-width);
  if (!v.length) return paint(C.gray, "·".repeat(width));
  const max = Math.max(1, ...v);
  let s = "";
  for (const x of v) {
    const idx = clamp(Math.floor((x / max) * (BARS.length - 1)), 0, BARS.length - 1);
    s += gradient(x / max) + BARS[idx];
  }
  return s + RESET + (v.length < width ? paint(C.gray, "·".repeat(width - v.length)) : "");
}

// A rounded panel. `lines` are pre-colored; we fit each to the inner width.
export function box({ title = "", width, lines, color = C.gray, footer = "" }) {
  const inner = width - 2;
  const head = title ? ` ${title} ` : "";
  const top = color + "╭" + head + "─".repeat(Math.max(0, inner - visLen(head))) + "╮" + RESET;
  const out = [top];
  for (const ln of lines) out.push(color + "│" + RESET + fit(" " + ln, inner) + color + "│" + RESET);
  const foot = footer ? ` ${footer} ` : "";
  out.push(color + "╰" + "─".repeat(Math.max(0, inner - visLen(foot))) + foot + "╯" + RESET);
  return out;
}

// "label  value" with the value right-aligned inside width.
export function kv(label, value, width) {
  const l = visLen(label), v = visLen(value);
  const gap = Math.max(1, width - l - v);
  return label + " ".repeat(gap) + value;
}
