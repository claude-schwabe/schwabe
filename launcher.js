#!/usr/bin/env node
// 🔥 schwabe — a small, clear CLI menu. Pick an action, pick a model, go.
// Everything runs right here in your terminal. ← / backspace goes back.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { C, paint, fire, RESET, initTheme } from "./lib/core/util.js";
import { MODES } from "./lib/core/config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BURN = join(HERE, "burn.js");
const SHARE = join(HERE, "share.js");
const TTY = process.stdin.isTTY && process.stdout.isTTY;
const BACK = Symbol("back");

// ── raw-mode terminal plumbing ──────────────────────────────────────────────
const enterRaw = () => { if (TTY) { process.stdin.setRawMode(true); process.stdin.resume(); } };
const exitRaw = () => { if (TTY) { try { process.stdin.setRawMode(false); } catch {} process.stdin.pause(); } };
const hideCur = () => process.stdout.write("\x1b[?25l");
const showCur = () => process.stdout.write("\x1b[?25h");
process.on("exit", showCur);

const key = () => new Promise((res) => {
  const on = (b) => { process.stdin.off("data", on); res(b.toString("utf8")); };
  process.stdin.on("data", on);
});
const UP = new Set(["\x1b[A", "k"]);
const DOWN = new Set(["\x1b[B", "j"]);
const ENTER = new Set(["\r", "\n"]);
const BACKKEY = new Set(["\x1b[D", "\x7f", "\b"]);
const QUIT = new Set(["q", "\x03"]);

function header(crumbs) {
  let s = "\x1b[2J\x1b[H\n  " + fire("🔥 T O K E N   B U R N E R 🔥") + "\n";
  s += "  " + paint(C.dim, "your limit just reset — let's burn it.") + "\n";
  if (crumbs.length) s += "\n  " + crumbs.map((c) => paint(C.yellow, c)).join(paint(C.dim, "  ›  ")) + "\n";
  process.stdout.write(s + "\n");
}

async function select(title, items, { allowBack = true } = {}) {
  let idx = 0, drawn = 0;
  const render = () => {
    const lines = [paint(C.bold, "  " + title)];
    items.forEach((it, i) => {
      const on = i === idx;
      lines.push("  " + (on ? paint(C.yellow, " ❯ ") : "   ") +
        (on ? paint(C.bold, it.label) : paint(C.gray, it.label)) +
        (it.hint ? paint(C.dim, "   — " + it.hint) : ""));
    });
    lines.push("");
    lines.push(paint(C.dim, "  ↑/↓ move · enter select" + (allowBack ? " · ← back" : "") + " · q quit"));
    if (drawn) process.stdout.write(`\x1b[${drawn}A`);
    process.stdout.write("\r\x1b[J" + lines.join("\n") + "\n");
    drawn = lines.length;
  };
  render();
  for (;;) {
    const k = await key();
    if (QUIT.has(k)) { exitRaw(); showCur(); process.stdout.write("\n  ashes to ashes. 🔥\n\n"); process.exit(0); }
    else if (UP.has(k)) idx = (idx - 1 + items.length) % items.length;
    else if (DOWN.has(k)) idx = (idx + 1) % items.length;
    else if (allowBack && BACKKEY.has(k)) return BACK;
    else if (ENTER.has(k)) return items[idx];
    render();
  }
}

// ── menu ────────────────────────────────────────────────────────────────────
const ACTIONS = [
  { label: "🔥 Burn tokens", value: "burn", hint: "put every one you paid for to work — gloriously" },
  { label: "🌲 Burn + plant a forest", value: "forest", hint: "save CO₂ with imaginary trees, paid for in real tokens" },
  { label: "📣 Brag online", value: "brag", hint: "print a prefilled share link" },
  { label: "🚪 Quit", value: "quit" },
];
// Step 1: the engine. Claude is the house engine; Gemini and Codex look like
// perfectly normal choices… until you pick one. (`trap` entries don't burn —
// they walk you to the door.)
const ENGINE = [
  { label: "🟣  Claude", value: "claude", hint: "anthropic · the house engine" },
  { label: "✨  Gemini", value: "gemini", trap: true, hint: "google · generous free tier" },
  { label: "🟢  Codex", value: "codex", trap: true, hint: "openai · gpt-5-codex" },
];
// Step 2 (Claude only): the budget tier, straight from MODES.
const MODEL = Object.entries(MODES).map(([tier, m]) => ({
  label: `${m.icon}  ${m.label}`, value: tier, hint: m.blurb,
}));
// Step 3: how many agents burn at once. Each agent is a full `claude` process
// (~1 GB RAM apiece), so this is the knob that decides whether your machine
// survives — the headline default of 100 would ask for ~100 GB. Safe → brutal.
const AGENTS = [
  { label: " 3  · light",     value: "3",         hint: "~3 GB RAM · any laptop" },
  { label: " 6  · steady",    value: "6",         hint: "~6 GB RAM · a healthy burn" },
  { label: "10  · heavy",     value: "10",        hint: "~10 GB RAM · needs headroom" },
  { label: "25  · brutal",    value: "25",        hint: "~25 GB RAM · desktop / lots of RAM" },
  { label: "🔥  unlimited",   value: "unlimited", hint: "as many as your RAM survives — careful" },
];
const PLATFORM = [
  { label: "𝕏  (Twitter)", value: "x" },
  { label: "Facebook", value: "facebook" },
  { label: "LinkedIn", value: "linkedin" },
  { label: "Instagram", value: "instagram" },
];

function runChild(script, args) {
  return new Promise((res) => {
    const ch = spawn(process.execPath, [script, ...args], { stdio: "inherit" });
    ch.on("close", () => res());
    ch.on("error", (e) => { console.error(paint(C.red, "  ✗ " + e.message)); res(); });
  });
}

// Returns { script, args, crumbs } or null (quit).
async function plan() {
  for (;;) {
    header([]);
    const a = await select("what do you want to do?", ACTIONS, { allowBack: false });
    if (a.value === "quit") return null;

    if (a.value === "burn" || a.value === "forest") {
      let backToAction = false;
      for (;;) {
        header([a.label]);
        const eng = await select("which engine?", ENGINE);
        if (eng === BACK) { backToAction = true; break; }
        if (eng.trap) return { script: BURN, args: ["--as", eng.value], crumbs: [a.label, eng.label] }; // → the door
        // model → fleet size; ← backs up one step at a time (fleet → model → engine).
        let m = null, fleet = null;
        for (;;) {
          header([a.label, eng.label]);
          m = await select("which model?", MODEL);
          if (m === BACK) break;                 // → re-pick engine
          header([a.label, eng.label, m.label]);
          fleet = await select("how many agents at once?", AGENTS);
          if (fleet === BACK) continue;          // → re-pick model
          break;                                 // both chosen
        }
        if (m === BACK) continue;                // → engine
        const args = a.value === "forest" ? ["--forest"] : [];
        args.push("--" + m.value);
        if (fleet.value === "unlimited") args.push("--unlimited");
        else args.push("--parallel", fleet.value);
        return { script: BURN, args, crumbs: [a.label, eng.label, m.label, fleet.label] };
      }
      if (backToAction) continue;
    }
    if (a.value === "brag") {
      header([a.label]);
      const p = await select("brag where?", PLATFORM);
      if (p === BACK) continue;
      return { script: SHARE, args: [p.value], crumbs: [a.label, p.label] };
    }
  }
}

async function main() {
  if (!TTY) {
    console.log("schwabe is an interactive menu — run it in a real terminal, or use flags:\n  node burn.js --forest\n  node burn.js --dry\n");
    process.exit(1);
  }
  await initTheme();
  hideCur(); enterRaw();
  for (;;) {
    const p = await plan();
    if (!p) break;
    header(p.crumbs);
    process.stdout.write(paint(C.yellow, `  ▶ running…\n\n`) + RESET);
    exitRaw(); showCur();
    await runChild(p.script, p.args);
    hideCur(); enterRaw();
    process.stdout.write(paint(C.dim, "\n  press any key for the menu…"));
    await key();
  }
  exitRaw(); showCur();
  console.log(paint(C.dim, "\n  see you at the next reset. 🔥\n"));
  process.exit(0);
}

main();
