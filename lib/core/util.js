// Shared low-level helpers: ANSI, color gradients, number formatting,
// ANSI-aware width math (so boxed TUI panels never misalign), and an EMA.
// Everything here is pure and dependency-free.

export const ESC = "\x1b[";
export const RESET = ESC + "0m";

export const sgr = (...n) => `${ESC}${n.join(";")}m`;
export const fg = (r, g, b) => `${ESC}38;2;${r};${g};${b}m`;
export const bg = (r, g, b) => `${ESC}48;2;${r};${g};${b}m`;

// ── theme: auto light/dark so the CLI stays readable on any terminal ──────
const DARK = {
  reset: RESET, bold: sgr(1), dim: sgr(2),
  red: sgr(31), green: sgr(32), yellow: sgr(33), blue: sgr(34),
  mag: sgr(35), cyan: sgr(36), white: sgr(97), gray: sgr(90),
};
// On a light background, bright-white / yellow / dim vanish — remap to ink-dark,
// readable equivalents so the same code looks clean on white too.
const LIGHT = {
  reset: RESET, bold: sgr(1), dim: fg(150, 154, 160),
  red: fg(200, 40, 32), green: fg(28, 140, 66), yellow: fg(176, 120, 8),
  blue: fg(40, 96, 210), mag: fg(168, 40, 150), cyan: fg(20, 138, 160),
  white: fg(28, 30, 34), gray: fg(96, 100, 106),
};
// Live palette — modules read C.* at render time, so applyTheme() can swap the
// whole look after detection without anyone re-importing.
export const C = { ...DARK };
export function applyTheme(light) { Object.assign(C, light ? LIGHT : DARK); C.isLight = !!light; }

// Sync guess from the COLORFGBG env var (set by iTerm2, Konsole, …).
export function detectLightSync() {
  const cf = process.env.COLORFGBG;
  if (cf) {
    const bg = parseInt(cf.split(";").pop(), 10);
    if (Number.isFinite(bg)) return bg === 7 || bg === 15 || (bg >= 9 && bg <= 15);
  }
  return false;
}

// Ask the terminal its background color (OSC 11) with a short timeout; restores
// stdin afterwards so callers can keep using it.
function probeBgColor(timeoutMs = 160) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY || !stdout.isTTY) return resolve(null);
    let done = false, buf = "";
    const prevRaw = !!stdin.isRaw;
    const finish = (v) => {
      if (done) return; done = true;
      clearTimeout(timer); stdin.off("data", onData);
      try { stdin.setRawMode(prevRaw); } catch {}
      if (!prevRaw) stdin.pause();
      resolve(v);
    };
    const onData = (d) => {
      buf += d.toString("latin1");
      const m = /\x1b\]11;rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(buf);
      if (m) { const hi = (h) => parseInt(h.slice(0, 2), 16); finish({ r: hi(m[1]), g: hi(m[2]), b: hi(m[3]) }); }
    };
    try { stdin.setRawMode(true); } catch {}
    stdin.resume();
    stdin.on("data", onData);
    stdout.write("\x1b]11;?\x07");
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

// Detect + apply the theme. Call once at startup before rendering.
export async function initTheme() {
  let light = detectLightSync();
  if (process.env.COLORFGBG == null) {
    const bg = await probeBgColor();
    if (bg) light = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) > 150;
  }
  applyTheme(light);
  return light;
}

applyTheme(detectLightSync());   // best sync guess at load; initTheme() refines it

export const paint = (code, s) => `${code}${s}${RESET}`;

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// btop-style heat gradient: green → yellow → red, t in [0,1].
export function gradient(t) {
  t = clamp(t, 0, 1);
  if (t < 0.5) { const k = t / 0.5; return fg(lerp(46, 255, k), lerp(204, 220, k), lerp(64, 0, k)); }
  const k = (t - 0.5) / 0.5; return fg(lerp(255, 255, k), lerp(220, 59, k), lerp(0, 48, k));
}

// 🔥 Flame-gradient headline text: red → yellow → ember → red, cycled per char.
// The shared brand voice for banners (the menu header, the cremation receipt).
export const fire = (s) =>
  [...s].map((ch, i) => paint([C.red, C.yellow, gradient(0.7) + "", C.red][i % 4] || "", ch)).join("");

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const nf = (n) => Math.round(n || 0).toLocaleString("en-US");
export const usd = (n) => "$" + (n || 0).toFixed(4);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Number(process.hrtime.bigint() / 1000000n);

export function hms(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ── ANSI-aware width math ───────────────────────────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (s) => String(s).replace(ANSI_RE, "");
export const visLen = (s) => stripAnsi(s).length;

export function truncVisible(s, w) {
  let out = "", vis = 0, i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
      if (m) { out += m[0]; i += m[0].length; continue; }
    }
    if (vis >= w) break;
    out += s[i]; vis++; i++;
  }
  return out + (vis >= w ? RESET : "");
}

export const padEndVisible = (s, w) => {
  const len = visLen(s);
  return len >= w ? s : s + " ".repeat(w - len);
};

// Fit a (possibly colored) string into exactly w visible columns.
export const fit = (s, w) => padEndVisible(truncVisible(s, w), w);

// Exponential moving average.
export class EMA {
  constructor(alpha = 0.3) { this.alpha = alpha; this.value = null; }
  push(x) { this.value = this.value == null ? x : this.alpha * x + (1 - this.alpha) * this.value; return this.value; }
}
