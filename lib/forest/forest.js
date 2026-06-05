// 🌲 The forest aggregate: collect this run's trees (plus every tree from prior
// runs), lay them into a square grid above grassy ground lines, crown it with a
// virtual-CO₂-savings certificate, and persist the whole thing to FOREST.txt.
//
// We claim, with a completely straight face, to be carbon negative. We are not.
// That is the entire joke. Trees are fixed-size blocks (see ./tree.js), so the
// grid needs zero edge-matching — blocks just tile side by side. Clean by design.

import { appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { nf } from "../core/util.js";
import { co2For, emittedKg } from "./species.js";
import { TREE_W, TREE_H, ROW_GAP } from "./tree.js";

const TUFTS = [".", ",", "'", "v", "`", "."];   // sparse grass on the forest floor
const groundLine = (width) =>
  Array.from({ length: width }, (_, i) => (i % 4 === 2 ? TUFTS[(i * 3) % TUFTS.length] : " ")).join("");

const kg = (n) => `${n.toFixed(1)} kg`;

export class Forest {
  constructor({ cols = null, txtPath = "FOREST.txt", dataPath = "forest.jsonl" } = {}) {
    this.cols = cols;   // null → auto square grid (⌈√n⌉)
    this.txtPath = txtPath;
    this.dataPath = dataPath;
    this.trees = [];        // this run's new trees: { species, lines, tokens }
    this.statuses = [];     // per planned slot (seed→growing→planted); tracked for tests/future UI, not read by any renderer today
    this.prior = this._loadPrior();   // every tree from previous runs (the forest grows)
  }

  _loadPrior() {
    const prior = [];
    if (!existsSync(this.dataPath)) return prior;
    for (const line of readFileSync(this.dataPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const t = JSON.parse(line); if (Array.isArray(t.lines)) prior.push(t); } catch { /* skip */ }
    }
    return prior;
  }

  plan(n) { this.statuses = Array.from({ length: n }, () => "seed"); }
  setStatus(i, s) { if (i >= 0 && i < this.statuses.length) this.statuses[i] = s; }

  plant(index, lines, species, tokens) {
    const tree = { species, lines, tokens };
    this.trees.push(tree);
    this.setStatus(index, "planted");
    try { appendFileSync(this.dataPath, JSON.stringify({ ...tree, ts: new Date().toISOString() }) + "\n"); } catch { /* best effort */ }
  }

  get planted() { return this.trees.length; }
  get runTokens() { return this.trees.reduce((s, t) => s + (t.tokens || 0), 0); }
  get lifetimeTrees() { return this.prior.length + this.trees.length; }
  get lifetimeTokens() { return this.prior.reduce((s, t) => s + (t.tokens || 0), 0) + this.runTokens; }
  allTrees() { return [...this.prior, ...this.trees]; }

  // Virtual CO₂ savings = the real per-species rates summed over every tree.
  savingsKgPerYear() { return this.allTrees().reduce((s, t) => s + co2For(t.species), 0); }
  emittedKgTotal() { return emittedKg(this.lifetimeTokens); }

  // Trees per row so the forest forms a square block (⌈√n⌉), unless overridden.
  colsFor(n) { return this.cols || Math.max(1, Math.ceil(Math.sqrt(n))); }

  // Lay trees into a square grid, each row sitting on a grassy ground line.
  renderForest(trees = this.allTrees()) {
    if (!trees.length) return "  (an empty clearing, for now — plant something)";
    const cols = this.colsFor(trees.length);
    const rowWidth = cols * TREE_W + (cols - 1) * (ROW_GAP + 1);
    const out = [];
    for (let i = 0; i < trees.length; i += cols) {
      const row = trees.slice(i, i + cols);
      for (let line = 0; line < TREE_H; line++) {
        out.push(row.map((t) => (t.lines[line] || "").padEnd(TREE_W)).join(" ".repeat(ROW_GAP + 1)));
      }
      out.push(groundLine(rowWidth));
    }
    return out.join("\n");
  }

  // The virtual-savings panel that crowns the file.
  certificate() {
    const row = (label, value) => `║  ${String(label).padEnd(28)} : ${String(value).padEnd(29)}║`;
    return [
      "╔══════════════════════════════════════════════════════════════╗",
      "║                  🌲  VIRTUAL CO₂ SAVINGS  🌲                   ║",
      "╠══════════════════════════════════════════════════════════════╣",
      row("trees planted (lifetime)", nf(this.lifetimeTrees)),
      row("tokens burned to plant them", nf(this.lifetimeTokens)),
      row("virtual CO₂ savings", `${kg(this.savingsKgPerYear())} / year`),
      row("real CO₂ emitted (burning)", `~${kg(this.emittedKgTotal())}`),
      "╚══════════════════════════════════════════════════════════════╝",
    ].join("\n");
  }

  toDocument() {
    return [
      "🌲  YOUR VIRTUAL FOREST  🌲",
      "planted by burning tokens — the more you burn, the more you \"offset\".",
      "",
      this.certificate(),
      "",
      this.renderForest(),
      "",
    ].join("\n");
  }

  // Write the one big file. Called live as trees land (throttled) and forced once
  // at the end, so a huge "unlimited" run doesn't rewrite the whole forest per tree.
  flush(force = false) {
    const t = Date.now();
    if (!force && t - (this._lastFlush || 0) < 1000) return this.txtPath;
    this._lastFlush = t;
    try { writeFileSync(this.txtPath, this.toDocument()); } catch { /* best effort */ }
    return this.txtPath;
  }
}
