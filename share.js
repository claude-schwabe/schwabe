#!/usr/bin/env node
// 🔥 BRAG. (against your better judgment)
// Reconstruct your most recent burn from the ledger and print a prefilled share
// link, behind a quick "heads up before you post" confirmation.
//
//   node share.js x                  # confirm, print a prefilled tweet link
//   node share.js linkedin --yes     # skip the y/N prompt
//
// Platforms: facebook · linkedin · instagram · x   (see lib/integrations)

import { existsSync, readFileSync } from "node:fs";
import { CSV_HEADER, parseLine } from "./lib/engine/ledger.js";
import { resolvePlatform, listPlatforms } from "./lib/integrations/index.js";
import { shareRun, DEFAULT_LINK } from "./lib/integrations/share.js";
import { C, paint, nf, usd } from "./lib/core/util.js";

const CSV_PATH = "burns.csv";

// ── tiny argv parse (matches the repo's flag spirit) ───────────────────────
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const platformArg = argv.find((a) => !a.startsWith("--"));
const assumeYes = flags.has("--yes");

if (!platformArg) {
  console.error(paint(C.red, "\n   which platform? ") + paint(C.gray, `pick one of: ${listPlatforms().join(", ")}`));
  console.error(paint(C.gray, "   e.g. node share.js x --yes\n"));
  process.exit(2);
}

let platform;
try {
  platform = resolvePlatform(platformArg);
} catch (e) {
  console.error(paint(C.red, `\n   ✗ ${e.message}\n`));
  process.exit(2);
}

// ── reconstruct the latest run from the ledger ─────────────────────────────
const summary = latestRunSummary();
if (!summary) {
  console.error(paint(C.yellow, "\n   nothing to brag about yet — no burns in ") + paint(C.cyan, CSV_PATH) + paint(C.yellow, "."));
  console.error(paint(C.gray, "   go burn something first:  node burn.js --dry\n"));
  process.exit(1);
}

console.log(
  paint(C.gray, "\n   last burn → ") +
  paint(C.red, nf(summary.tokens) + " tok") + paint(C.gray, " · ") +
  paint(C.green, usd(summary.cost)) + paint(C.gray, " · ") +
  paint(C.cyan, summary.agents + " agents") +
  (summary.runId ? paint(C.gray, `  (${summary.runId})`) : "")
);

await shareRun({ platform, summary, assumeYes, link: DEFAULT_LINK });

// ── helpers ────────────────────────────────────────────────────────────────

// Group burns.csv by the MOST RECENT run_id (latest ts wins — the CSV is append
// order, not strictly time order). Reuses ledger's quote-aware parseLine.
function latestRunSummary() {
  if (!existsSync(CSV_PATH)) return null;
  const lines = readFileSync(CSV_PATH, "utf8").trim().split("\n");
  if (lines.length < 2) return null;

  const idx = Object.fromEntries(CSV_HEADER.map((h, i) => [h, i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length < CSV_HEADER.length) continue;
    rows.push(cols);
  }
  if (!rows.length) return null;

  // newest run = the run_id of the row with the latest timestamp.
  let newest = rows[0];
  for (const r of rows) {
    if ((r[idx.ts] || "") > (newest[idx.ts] || "")) newest = r;
  }
  const runId = newest[idx.run_id];
  const mine = rows.filter((r) => r[idx.run_id] === runId);

  let tokens = 0, cost = 0;
  for (const r of mine) {
    tokens += Number(r[idx.total_tokens]) || 0;
    cost += Number(r[idx.cost_usd]) || 0;
  }
  return { runId, tokens, cost, agents: mine.length };
}
