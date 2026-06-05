// The persistent record. Two files, both append-only across every run:
//   burns.csv     — one tidy metrics row per agent (the ledger you asked for)
//   ashes.jsonl   — the full glorious masterpiece + usage, for forging the Hall
// CSV is the source of truth for lifetime totals.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { totalTokens } from "../backends/base.js";

export const CSV_HEADER = [
  "ts", "run_id", "agent", "backend", "model", "task",
  "input_tokens", "output_tokens", "cache_read", "cache_creation",
  "total_tokens", "cost_usd", "duration_ms", "ok", "estimated",
];

const esc = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export class Ledger {
  constructor({ csvPath, jsonlPath, runId, model, backend }) {
    this.csvPath = csvPath;
    this.jsonlPath = jsonlPath;
    this.runId = runId;
    this.model = model;
    this.backend = backend;
    if (!existsSync(csvPath) || readFileSync(csvPath, "utf8").trim() === "") {
      writeFileSync(csvPath, CSV_HEADER.join(",") + "\n");
    }
  }

  record(agent, result) {
    const u = result.usage;
    const row = [
      new Date().toISOString(), this.runId, agent.id, this.backend, this.model, agent.label,
      u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheCreationTokens,
      totalTokens(u), result.costUsd.toFixed(6), Math.round(result.durationMs),
      result.ok ? 1 : 0, result.estimated ? 1 : 0,
    ];
    appendFileSync(this.csvPath, row.map(esc).join(",") + "\n");
    appendFileSync(this.jsonlPath, JSON.stringify({
      ts: row[0], runId: this.runId, agent: agent.id, backend: this.backend,
      model: this.model, task: agent.label, adj: agent.adj,
      ok: result.ok, error: result.error, usage: u, costUsd: result.costUsd,
      text: result.text,
    }) + "\n");
  }
}

// Quote-aware CSV line parser (task labels contain commas, so naive split lies).
// Exported so share.js can read the ledger without re-implementing CSV parsing.
export function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Lifetime totals from the CSV, so the dashboard can show "you have burned X
// across all time" alongside this run.
export function loadLifetime(csvPath) {
  const out = { rows: 0, tokens: 0, cost: 0 };
  if (!existsSync(csvPath)) return out;
  const lines = readFileSync(csvPath, "utf8").trim().split("\n");
  const ti = CSV_HEADER.indexOf("total_tokens"), ci = CSV_HEADER.indexOf("cost_usd");
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length < CSV_HEADER.length) continue;
    out.rows++;
    out.tokens += Number(cols[ti]) || 0;
    out.cost += Number(cols[ci]) || 0;
  }
  return out;
}
