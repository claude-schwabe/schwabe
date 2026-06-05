// btop/htop-style live dashboard. `frame()` is pure (returns the lines) so it can
// be unit-tested; `render()` paints it to the alternate screen. Subscribes to the
// fleet and reads Metrics; owns no business logic.

import { C, RESET, paint, nf, usd, hms, clamp, gradient, fit } from "../core/util.js";
import { box, meter, sparkline, spinner, kv } from "./widgets.js";
import { modeInfo, modelLabel } from "../core/config.js";
import { TREE_H, TREE_W } from "../forest/index.js";

const ALT_ON = "\x1b[?1049h\x1b[?25l";
const ALT_OFF = "\x1b[?25h\x1b[?1049l";
const HOME = "\x1b[H";
const CLR_DOWN = "\x1b[J";

// Forest zoom ladder for the live panel. The more trees you plant, the smaller
// each one is drawn, so the whole forest keeps fitting on screen ("zoom out" as it
// grows) — but every tree stays the REAL generated one, just shrunk, so a birch
// still reads as a birch next to a cactus. FOREST_SCALES is the shrink factor at
// each level; pickZoom() uses the most detailed level whose grid holds every tree.
const FOREST_SCALES = [1, 2, 3, 4, 6, 8, 12, 24];

// Downscale a tree's ASCII art by integer factor f: each f×f block becomes one
// cell, taking its most common non-space char (so any ink survives — the silhouette
// thins gracefully instead of dropping out). f=1 returns the art untouched. Result
// is memoized per (tree, f); planted trees are immutable, so the cache stays valid.
// Exported for unit tests.
export function miniTree(t, f) {
  if (f <= 1) return t.lines;
  if (!t._mini) t._mini = new Map();
  let out = t._mini.get(f);
  if (out) return out;
  const newH = Math.ceil(TREE_H / f), newW = Math.ceil(TREE_W / f);
  out = [];
  for (let R = 0; R < newH; R++) {
    let row = "";
    for (let C = 0; C < newW; C++) {
      const counts = new Map();
      for (let y = R * f; y < Math.min(TREE_H, (R + 1) * f); y++) {
        const ln = t.lines[y] || "";
        for (let x = C * f; x < Math.min(TREE_W, (C + 1) * f); x++) {
          const ch = ln[x];
          if (ch && ch !== " ") counts.set(ch, (counts.get(ch) || 0) + 1);
        }
      }
      let best = " ", bestN = 0;
      for (const [ch, n] of counts) if (n > bestN) { best = ch; bestN = n; }
      row += best;
    }
    out.push(row);
  }
  t._mini.set(f, out);
  return out;
}

// A zoom level derived from a shrink factor: the shrunk tree's dimensions, plus
// tight gaps so the grid reads as a packed forest (canopies nearly touching).
function zoomLevel(f) {
  const w = Math.ceil(TREE_W / f), h = Math.ceil(TREE_H / f);
  return { w, h, f, gap: w >= 3 ? 1 : 0, vgap: f === 1 ? 1 : 0, sprite: (t) => miniTree(t, f) };
}
const FOREST_ZOOMS = FOREST_SCALES.map(zoomLevel);

export class TuiRenderer {
  constructor(fleet, metrics, cfg, onQuit, forest = null) {
    this.fleet = fleet;
    this.metrics = metrics;
    this.cfg = cfg;
    this.forest = forest;
    this.onQuit = onQuit || (() => process.exit(130));
    this._frame = 0;
    this._seq = 0;
    this._timer = null;
    this._stopped = false;
  }

  start() {
    this.fleet.on("agent:done", ({ agent }) => { agent._seq = ++this._seq; });
    process.stdout.write(ALT_ON);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      this._onKey = (buf) => {
        const k = buf.toString();
        if (k === "q" || k === "\x03") this._quit();
      };
      process.stdin.on("data", this._onKey);
    }
    this._sigint = () => this._quit();
    process.on("SIGINT", this._sigint);
    this.render();
    this._timer = setInterval(() => this.render(), 100);
  }

  // An endless burn never ends on its own, so q / Ctrl-C is the normal way out:
  // the first press asks the fleet to drain (the run then finishes cleanly with a
  // receipt), a second one hard-exits. A finite run just quits on the first press.
  _quit() {
    if (this.fleet.infinite && !this.fleet.stopping) { this.fleet.stop(); this.render(); return; }
    this.stop();
    this.onQuit();
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    clearInterval(this._timer);
    if (this._onKey) process.stdin.off("data", this._onKey);
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch {} process.stdin.pause(); }
    process.removeListener("SIGINT", this._sigint);
    process.stdout.write(ALT_OFF);
  }

  render() {
    this._frame++;
    this.metrics.tick();
    const lines = this.frame();
    process.stdout.write(HOME + lines.join("\r\n") + CLR_DOWN);
  }

  // ── pure frame builder ────────────────────────────────────────────────
  // Compose four stacked panels into exactly H lines, each fit to W columns.
  frame() {
    const W = Math.min(process.stdout.columns || 100, 120);
    const H = (process.stdout.rows || 32) - 1;
    const inner = W - 4;

    const header = this.headerPanel(W, inner);
    const ledger = this.ledgerPanel(W, inner);
    // Forest is sized before the fleet (it's the star in forest mode and gets the
    // space); the fleet then fills whatever's left. Ledger height is known up front
    // so the forest never grows tall enough to push the ledger off the bottom.
    const forest = this.forestPanel(W, H, header.length, ledger.length);
    const chrome = header.length + ledger.length + forest.length + 2; // +2 for the fleet box borders
    const fleet = this.fleetPanel(W, H, inner, chrome);

    const out = [...header, ...forest, ...fleet, ...ledger];
    while (out.length < H) out.push("");
    return out.slice(0, H).map((l) => fit(l, W));
  }

  // Header: an endless burn gets the "∞ BURNING FOREVER" banner; a finite --count
  // run keeps the classic progress meter.
  headerPanel(W, inner) {
    return this.fleet.infinite ? this._headerInfinite(W, inner) : this._headerFinite(W, inner);
  }

  // Finite: progress meter, live tokens/rate/cost, the sparkline, rate-limit banner.
  _headerFinite(W, inner) {
    const m = this.metrics, f = this.fleet, cfg = this.cfg;
    const total = f.agents.length, done = f.done;
    const elapsed = f.startedAt ? (f.finishedAt || Date.now()) - f.startedAt : 0;
    const mode = modeInfo(cfg.mode);
    const right = paint(C.gray, `${mode.icon} ${paint(C.white, mode.label)}  ·  ${paint(C.white, cfg.backend)} ${paint(C.white, modelLabel(cfg.model))}`);
    const head = [
      kv(meter(done / total, 28) + paint(C.bold, `  ${done}/${total} done`) + paint(C.yellow, ` · ${f.running.length} running in parallel ⚡`), right, inner),
      kv(
        paint(C.bold, `🔥 ${paint(gradient(0.9) + "", nf(m.tokens + f.streamingTokens))}${RESET}${C.bold} tokens`) + paint(C.gray, `  ·  ${paint(C.cyan, nf(m.rate))} tok/s  ·  ${paint(C.green, usd(m.runCost))}`),
        paint(C.gray, `⏱ ${hms(elapsed)}`), inner,
      ),
      paint(C.cyan, sparkline(m.history, inner)),
    ];
    this._appendWaitBanner(head, f);
    const title = this.forest ? "🌲 TOKEN BURNER · planting a carbon-offset forest"
      : "🔥 TOKEN BURNER · live incinerator";
    return box({ title, width: W, lines: head, color: gradient(0.85) });
  }

  // Endless: no finish line — a forever banner, the live parallel count, cumulative
  // burned, the big token counter, rate/cost, and the sparkline.
  _headerInfinite(W, inner) {
    const m = this.metrics, f = this.fleet, cfg = this.cfg;
    const elapsed = f.startedAt ? (f.finishedAt || Date.now()) - f.startedAt : 0;
    const mode = modeInfo(cfg.mode);
    const right = paint(C.gray, `${mode.icon} ${paint(C.white, mode.label)}  ·  ${paint(C.white, cfg.backend)} ${paint(C.white, modelLabel(cfg.model))}`);
    const banner = f.stopping
      ? paint(C.yellow, "■ WRAPPING UP — draining in-flight agents…")
      : paint(gradient(0.92) + "", "∞ BURNING FOREVER");
    const left = banner +
      paint(C.bold, `   ${f.running.length}`) + paint(C.gray, ` / ${cfg.concurrency} in parallel ⚡`) +
      paint(C.gray, `  ·  ${paint(C.white, nf(f.completed))} burned`);
    const head = [
      kv(left, right, inner),
      kv(
        paint(C.bold, `🔥 ${paint(gradient(0.9) + "", nf(m.tokens + f.streamingTokens))}${RESET}${C.bold} tokens`) + paint(C.gray, `  ·  ${paint(C.cyan, nf(m.rate))} tok/s  ·  ${paint(C.green, usd(m.runCost))}`),
        paint(C.gray, `⏱ ${hms(elapsed)}`), inner,
      ),
      paint(C.cyan, sparkline(m.history, inner)),
    ];
    this._appendWaitBanner(head, f);
    const title = this.forest ? "🌲 TOKEN BURNER · endless forest · q to stop"
      : "🔥 TOKEN BURNER · endless incinerator · q to stop";
    return box({ title, width: W, lines: head, color: gradient(0.85) });
  }

  // Shared rate-limit banner appended to either header when agents are waiting.
  _appendWaitBanner(head, f) {
    const waiting = f.waiting;
    if (!waiting.length) return;
    const soon = Math.max(0, Math.ceil((Math.min(...waiting.map((a) => a.retry?.until || Infinity)) - Date.now()) / 1000));
    head.push(paint(C.yellow, `⏳ RATE-LIMITED · out of budget — auto-resuming in ~${soon}s · ${waiting.length} agent${waiting.length > 1 ? "s" : ""} waiting · we keep trying`));
  }

  // Forest live preview — only while planting; an empty array otherwise. In forest
  // mode the forest gets the lion's share of the height (the fleet collapses to a
  // compact flame strip); `avail` reserves just enough for the header, ledger, that
  // strip, and the box chrome so nothing below gets clipped.
  forestPanel(W, H, headerLen, ledgerLen) {
    if (!this.forest) return [];
    const fo = this.forest, f = this.fleet;
    const stat = paint(C.green, `🌲 ${fo.planted} this run · ${fo.lifetimeTrees} lifetime`) +
      paint(C.gray, `  · virtual CO₂ savings ${fo.savingsKgPerYear().toFixed(0)} kg/yr · real CO₂ emitted ~${fo.emittedKgTotal().toFixed(1)} kg`);
    const avail = clamp(H - headerLen - ledgerLen - 8, 4, H);   // 8 ≈ fleet strip + box chrome
    return box({
      title: `FOREST · ${fo.planted} trees${f.running.length ? ` · ${f.running.length} sprouting` : ""}`,
      width: W, lines: [stat, ...this.forestPreview(avail)], color: C.green,
      footer: paint(C.dim, fo.txtPath),
    });
  }

  // Ledger: this-run totals, the in/out/cache split, peak rate, all-time CSV totals.
  ledgerPanel(W, inner) {
    const m = this.metrics, t = m.totals, cfg = this.cfg;
    const lines = [
      kv(paint(C.gray, "this run"), paint(C.white, `${nf(m.tokens)} tok  ·  ${usd(m.runCost)}  ·  ${t.ok}✓ ${t.errors ? paint(C.red, t.errors + "✗") : "0✗"}`), inner),
      kv(paint(C.gray, "in / out / cache"), paint(C.white, `${nf(t.input)} / ${nf(t.output)} / ${nf(t.cacheRead + t.cacheCreation)}`), inner),
      kv(paint(C.gray, "peak rate"), paint(C.white, `${nf(m.peak)} tok/s`), inner),
      kv(paint(C.gray, "all-time (csv)"), paint(C.yellow, `${nf(m.allTimeTokens)} tok  ·  ${usd(m.allTimeCost)}  across ${m.allTimeBurns} burns`), inner),
    ];
    return box({ title: "LEDGER", width: W, lines, color: C.gray, footer: paint(C.dim, `q quit · ${cfg.csvPath}`) });
  }

  // Endless runs get the flame-wall heatmap (it scales to thousands of agents);
  // a finite run keeps the per-agent detail rows.
  fleetPanel(W, H, inner, chromeLen) {
    return this.fleet.infinite ? this._heatPanel(W, H, inner, chromeLen) : this._fleetRows(W, H, inner, chromeLen);
  }

  // Fleet rows: running, then waiting, then most-recently-finished; fills the gap.
  _fleetRows(W, H, inner, chromeLen) {
    const f = this.fleet, cfg = this.cfg, waiting = f.waiting;
    const total = f.agents.length;
    const rowsAvail = clamp(H - chromeLen, 1, total);
    const running = f.agents.filter((a) => a.status === "running");
    const finished = f.agents.filter((a) => a.status === "done" || a.status === "error").sort((a, b) => (b._seq || 0) - (a._seq || 0));
    const display = [...running, ...waiting, ...finished].slice(0, rowsAvail);
    const lines = display.map((a) => this.row(a, inner));
    if (total - display.length > 0 && rowsAvail < total) lines.push(paint(C.dim, `…and ${total - display.length} more in the queue`));
    const title = `FLEET · ${running.length} burning${waiting.length ? ` · ${waiting.length} ⏳` : ""} / ${cfg.concurrency} cores`;
    return box({ title, width: W, lines, color: C.gray });
  }

  // The flame wall: one cell per parallel slot — a shimmering hot block while
  // burning, yellow while rate-limited, dim when idle — laid into a dense grid
  // that fills the panel. A few live detail rows + a legend sit underneath.
  _heatPanel(W, H, inner, chromeLen) {
    const f = this.fleet, cfg = this.cfg;
    const rowsAvail = clamp(H - chromeLen, 3, 400);
    const sampleN = clamp(rowsAvail - 3, 0, 5);                 // a few detail rows
    const gridRows = Math.max(1, rowsAvail - sampleN - 1);      // -1 for the legend line
    const cols = Math.max(8, inner - 1);
    const grid = this.heatGrid(cols, gridRows);
    const shown = Math.min(cfg.concurrency, cols * gridRows);
    const off = Math.max(0, f.running.length - shown);
    const legend =
      paint(gradient(0.8) + "", "█") + paint(C.gray, " burning   ") +
      paint(C.yellow, "▓") + paint(C.gray, " rate-limited   ") +
      paint(C.gray, "░ idle slot") +
      (off ? paint(C.dim, `   +${nf(off)} more off-screen`) : "");
    const running = f.agents.filter((a) => a.status === "running").slice(0, sampleN);
    const recent = f.agents.filter((a) => a.status === "done" || a.status === "error").sort((a, b) => (b._seq || 0) - (a._seq || 0));
    const sample = [...running, ...recent].slice(0, sampleN).map((a) => this.row(a, inner));
    const title = `FLEET · ${f.running.length} burning${f.waiting.length ? ` · ${f.waiting.length} ⏳` : ""} / ${cfg.concurrency} parallel`;
    return box({ title, width: W, lines: [...grid, legend, ...sample], color: gradient(0.55) });
  }

  // Build the heat grid: `cols`×`rows` cells, capped to concurrency. Running cells
  // shimmer (heat oscillates per-cell/frame), waiting cells pulse yellow, the rest
  // are dim idle slots. Cost is O(cells shown), independent of total concurrency.
  heatGrid(cols, rows) {
    const f = this.fleet, cfg = this.cfg;
    const running = f.running.length, waiting = f.waiting.length;
    const cap = Math.min(cfg.concurrency, cols * rows);
    const cells = [];
    for (let n = 0; n < cap; n++) {
      if (n < running) {
        const heat = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin((this._frame + n * 2.3) / 7));
        cells.push(gradient(heat) + "█");
      } else if (n < running + waiting) {
        cells.push(C.yellow + ((this._frame + n) % 2 ? "▓" : "▒"));
      } else {
        cells.push(C.gray + "░");
      }
    }
    if (!cells.length) return [paint(C.dim, "  (igniting…)")];
    const lines = [];
    for (let i = 0; i < cells.length; i += cols) lines.push(cells.slice(i, i + cols).join("") + RESET);
    return lines;
  }

  // The whole forest, zoomed to fit. We pick the most detailed zoom level whose
  // grid still holds every tree, so a handful render as full 24×14 ASCII trees and
  // a sprawling forest shrinks to mini-sprites or a field of canopy dots — it zooms
  // out as it grows. If it outgrows even the densest level, the newest rows stay in
  // view. Cost is O(cells shown), so an "unlimited" forest of thousands stays smooth.
  forestPreview(maxLines) {
    const trees = this.forest.trees;
    if (!trees.length) return [paint(C.dim, "  (planting…)")];
    const W = Math.min(process.stdout.columns || 100, 120) - 4;   // box content width
    const H = Math.max(1, maxLines);
    const n = trees.length;

    // Most detailed level that fits all n trees; otherwise the densest level.
    let z = FOREST_ZOOMS[FOREST_ZOOMS.length - 1], cols = 1, rows = 1;
    for (const lvl of FOREST_ZOOMS) {
      const c = Math.max(1, Math.floor((W + lvl.gap) / (lvl.w + lvl.gap)));
      const r = Math.max(1, Math.floor((H + lvl.vgap) / (lvl.h + lvl.vgap)));
      z = lvl; cols = c; rows = r;
      if (c * r >= n) break;
    }

    // Lay trees row by row; if even the densest level can't hold them all, keep the
    // most recent rows in view (the forest scrolls up as fresh saplings land).
    const totalRows = Math.ceil(n / cols);
    const startRow = Math.max(0, totalRows - rows);
    const out = [];
    for (let r = startRow; r < totalRows; r++) {
      const rowTrees = trees.slice(r * cols, r * cols + cols);
      for (let line = 0; line < z.h; line++) {
        out.push(rowTrees.map((t) => (z.sprite(t)[line] || "").padEnd(z.w).slice(0, z.w)).join(" ".repeat(z.gap)));
      }
      for (let v = 0; v < z.vgap; v++) out.push("");
    }
    return out.slice(0, H).map((l) => paint(C.green, l));
  }

  row(a, width) {
    const id = paint(C.gray, `agent-${a.id}`);
    let state, bar, label;
    if (a.status === "running") {
      state = paint(C.yellow, spinner(this._frame) + " burn");
      const pos = this._frame % 8;
      bar = Array.from({ length: 8 }, (_, i) => (i === pos || i === (pos + 1) % 8) ? gradient(0.6) + "▮" : C.gray + "▯").join("") + RESET;
      label = paint(C.dim, a.label);
    } else if (a.status === "waiting") {
      const left = Math.max(0, Math.ceil(((a.retry?.until || 0) - Date.now()) / 1000));
      state = paint(C.yellow, `⏳ ${left}s`);
      const pos = this._frame % 8;
      bar = Array.from({ length: 8 }, (_, i) => i === pos ? C.yellow + "▮" : C.gray + "▯").join("") + RESET;
      label = paint(C.yellow, `rate-limited — retry #${a.retry?.attempt || 1}`);
    } else if (a.status === "done") {
      state = paint(C.green, "✓ done"); bar = meter(1, 8);
      label = paint(C.dim, a.label);
    } else {
      state = paint(C.red, "✗ err "); bar = paint(C.red, "▮▮▮▮▮▮▮▮");
      label = paint(C.dim, (a.result && a.result.error) || "error");
    }
    const toks = paint(C.cyan, nf(a.tokens).padStart(8) + " tok");
    return fit(`${id} ${bar} ${fit(state, 7)}  ${toks}  ${label}`, width);
  }
}
