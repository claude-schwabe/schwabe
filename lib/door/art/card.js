// Draw the denial "card" NATIVELY in the terminal: crisp real-font text inside a
// colored frame, a no-entry emblem, and a punchline slab. Reads clean at any size
// (no downscaled-PNG blur). The matching PNG in art/ is the shareable keepsake;
// this is what shows on screen.

const fg = (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = (c) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const R = "\x1b[0m", B = "\x1b[1m";
const W = 50;                 // inner content width (chars)
const TOTAL = W + 4;          // + a 2-cell border each side

const center = (visW) => { const p = Math.max(0, W - visW); const l = (p / 2) | 0; return [l, p - l]; };
// a text row, centered on `page`, painted `color`, padded to the inner width.
const textRow = (s, color, page) => { const [l, r] = center(s.length); return page + color + " ".repeat(l) + s + " ".repeat(r) + R; };
// a pre-colored row of known visible width, centered on `page`.
const rawRow = (content, visW, page) => { const [l, r] = center(visW); return page + " ".repeat(l) + content + " ".repeat(r) + R; };

export function cardAnsi(spec) {
  const light = spec.bg === "light";
  const page = bg(light ? [245, 246, 248] : [12, 15, 17]);
  const ink = light ? [28, 30, 34] : [232, 236, 240];
  const sub = light ? [110, 114, 120] : [140, 146, 152];
  const red = [228, 64, 56], white = [248, 249, 251];
  const accent = spec.accent || red;
  const bcs = spec.border;

  // top/bottom rail: TOTAL cells split into colored bands.
  const rail = () => {
    let s = "";
    for (let i = 0; i < TOTAL; i++) s += bg(bcs[((i / TOTAL) * bcs.length) | 0 % bcs.length]) + " ";
    return s + R;
  };
  const side = (ri) => bg(bcs[ri % bcs.length]) + "  " + R;

  // the emblem: a red no-entry sign with a white bar (3 rows, 9 wide).
  const emblem = [
    rawRow(fg(red) + "▟███████▙" + R, 9, page),
    rawRow(bg(red) + "  " + bg(white) + "     " + bg(red) + "  " + R, 9, page),
    rawRow(fg(red) + "▜███████▛" + R, 9, page),
  ];

  const blank = textRow("", "", page);
  const body = [
    blank,
    ...emblem,
    blank,
    textRow(spec.title, B + fg(accent), page),
    textRow(spec.subtitle, B + fg(ink), page),
    blank,
    textRow(spec.big, B + fg(white), bg(accent)),   // full-width slab
    blank,
    textRow(spec.footer, fg(sub), page),
    blank,
  ];

  const out = [rail(), ...body.map((row, i) => side(i) + row + side(i)), rail()];
  return out.map((l) => "  " + l).join("\n");
}
