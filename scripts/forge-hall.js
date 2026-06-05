#!/usr/bin/env node
// Turn a Token Burner fleet run into HALL_OF_FLAME.md.
//
//   node scripts/forge-hall.js <workflow-output.json> [--append]
//
// Accepts the raw Workflow result JSON ({ result: { pieces: [...] } }),
// a bare { pieces: [...] }, or a plain array of pieces. Each piece:
//   { id, task, adj, titleLine, masterpiece }

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const path = process.argv[2];
const append = process.argv.includes("--append");
if (!path) {
  console.error("usage: node scripts/forge-hall.js <workflow-output.json> [--append]");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path, "utf8"));
const pieces = raw.result?.pieces ?? raw.pieces ?? (Array.isArray(raw) ? raw : []);
if (!pieces.length) {
  console.error("no pieces found in", path);
  process.exit(1);
}

const quote = (text) =>
  String(text)
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");

const entry = (p, i) => {
  const id = p.id ?? String(i + 1).padStart(3, "0");
  const title = p.titleLine || p.task || "Untitled Incineration";
  const sub = [p.task, p.adj].filter(Boolean).join(", ");
  return `### 🔥 #${id} · ${title}\n\n` +
    (sub ? `*agent-${id} — ${sub}*\n\n` : "") +
    `${quote(p.masterpiece)}\n`;
};

const HALL = "HALL_OF_FLAME.md";
const banner =
  `# 🔥 HALL OF FLAME\n\n` +
  `> Trophies from the Token Burner fleet. Each entry below is one Claude agent\n` +
  `> that received exactly one glorious assignment and committed completely.\n` +
  `> **${pieces.length} masterpieces. Every token spent. Vibes: immaculate.**\n\n` +
  `> Regenerate after any \`/burn\`: \`node scripts/forge-hall.js <run.json>\`.\n\n---\n\n`;

const body = pieces.map(entry).join("\n---\n\n");

let out;
if (append && existsSync(HALL)) {
  const prev = readFileSync(HALL, "utf8").replace(/\s+$/, "");
  out = `${prev}\n\n---\n\n${body}\n`;
} else {
  out = `${banner}${body}\n`;
}

writeFileSync(HALL, out);
console.log(`🔥 forged ${HALL} — ${pieces.length} masterpieces enshrined.`);
