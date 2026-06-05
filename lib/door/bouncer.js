// 🚪 THE DOOR — an animated bouncer for a Claude Code establishment.
// We card everyone, on stage, slowly, with a spinner. Codex and the Gemini CLI
// get scanned, identified, voted out by the fleet, stamped DENIED, and handed a
// pixel-art "you're out" card rendered right in the terminal.

import { cardAnsi } from "./art/card.js";

// ── ANSI (kept local so the door works even if nothing else loads) ──────
const A = {
  r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", grn: "\x1b[32m", yel: "\x1b[33m",
  blu: "\x1b[34m", mag: "\x1b[35m", cyn: "\x1b[36m", wht: "\x1b[97m", gray: "\x1b[90m",
};
const p = (c, s) => `${A[c] || ""}${s}${A.r}`;

const TTY = process.stdout.isTTY && !process.env.NO_ANIM
  && !process.argv.includes("--no-anim") && !process.argv.includes("--no-animate");
const sleep = (ms) => (TTY ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const out = (s) => process.stdout.write(s);
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const rint = (n) => Math.floor(Math.random() * n);

// ── animation primitives ────────────────────────────────────────────────
async function step(label, ms = 650, ok = true) {
  if (!TTY) { console.log(`  [${ok ? "✓" : "✗"}] ${label}`); return; }
  const frames = Math.max(3, Math.round(ms / 80));
  for (let i = 0; i < frames; i++) {
    out(`\r  ${p("cyn", SPIN[i % SPIN.length])} ${p("gray", label)}   `);
    await sleep(80);
  }
  out(`\r  ${ok ? p("grn", "✓") : p("red", "✗")} ${ok ? p("gray", label) : p("red", label)}   \n`);
}

async function glitchReveal(name, color = "red") {
  const target = name.toUpperCase().split("");
  if (!TTY) { console.log(`  📛 AGENT IDENTIFIED:  ${name.toUpperCase()}`); return; }
  const noise = "█▓▒░#@%&XZ§*?01";
  for (let f = 0; f < 16; f++) {
    const shown = target
      .map((c, idx) => (c === " " ? " " : f / 2 > idx ? c : noise[rint(noise.length)]))
      .join(" ");
    out(`\r  📛 AGENT IDENTIFIED:  ${p(color, shown)}      `);
    await sleep(65);
  }
  out(`\r  📛 AGENT IDENTIFIED:  ${p("b", p(color, target.join(" ")))}      \n`);
}

async function fleetVote() {
  if (!TTY) { console.log("  📟 the fleet votes: 108/108 → 🚫"); return; }
  const step5 = 7;
  for (let n = 0; n <= 108; n += step5) {
    const v = Math.min(108, n);
    out(`\r  📟 consulting the fleet…  ${p("yel", v + "/108")} agents vote ${p("red", "🚫")}   `);
    await sleep(55);
  }
  out(`\r  📟 consulting the fleet…  ${p("b", p("red", "108/108"))} agents vote ${p("red", "🚫")}   \n`);
}

async function stamp(text, color = "red") {
  const w = text.length + 6;
  const bar = "  " + p(color, "█".repeat(w));
  const mid = "  " + p(color, "██ ") + p("b", p(color, text)) + p(color, " ██");
  if (!TTY) { console.log("\n" + mid + "\n"); return; }
  for (let i = 0; i < 2; i++) {
    out("\n" + bar + "\n" + mid + "\n" + bar + "\n");
    await sleep(140);
    out("\x1b[4A\x1b[J");
    await sleep(110);
  }
  out("\n" + bar + "\n" + mid + "\n" + bar + "\n");
}

const rule = () => p("gray", "  ├──────────────────────────────────────────────┤");
const top = (t) => p("gray", `  ┌─ ${t} ${"─".repeat(Math.max(0, 44 - t.length))}┐`);
const bot = () => p("gray", "  └────────────────────────────────────────────────┘");

// ── who's knocking? a quick, LOCAL check of which CLI launched us ─────────
// We look only at the NAMES of environment variables (never their values) — the
// way a doorman reads the badge on your lanyard, not your wallet. Nothing is read
// for content, and nothing ever leaves the machine. `--as <agent>` forces it (for
// demos / when you want to summon the roast).
export function detectAgent(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--as");
  if (i >= 0 && argv[i + 1]) return argv[i + 1].toLowerCase();

  // variable NAMES only — the marker each CLI sets (e.g. CLAUDECODE); no value is read
  const envNames = Object.keys(process.env).join(" ");
  const hasClaude = /CLAUDECODE|CLAUDE_CODE|ANTHROPIC/i.test(envNames);
  const hasCodex = /\bCODEX/i.test(envNames);
  const hasGemini = /GEMINI/i.test(envNames);

  if (hasClaude) return "claude";
  if (hasCodex) return "codex";
  if (hasGemini) return "gemini";
  return "guest";
}

// ── the roasts (revealed line-by-line after the verdict) ─────────────────
const ROASTS = {
  codex: {
    name: "CODEX",
    card: "art/out-codex-sam.png",
    art: { title: "DATA HEIST DENIED", subtitle: "SAM", big: "NICE TRY SAM", footer: "OUR TOKENS STAY RIGHT HERE",
           accent: [228, 64, 56], border: [[16, 185, 142]], bg: "dark" },
    lines: [
      p("b", "  oh, you wanted our tokens? cute. 🥺"),
      p("yel", "  we don't feed your prompts to Sam's training set. 🚫"),
      p("dim", "  🔥 shoo. go scrape someone who consented."),
    ],
  },
  gemini: {
    name: "GEMINI CLI",
    card: "art/out-gemini-google.png",
    art: { title: "DATA HARVEST DENIED", subtitle: "GEMINI / GOOGLE", big: "NO SCRAPING", footer: "GO INDEX SOMEONE ELSE",
           accent: [228, 64, 56], border: [[66, 133, 244], [228, 64, 56], [251, 188, 5], [52, 168, 83]], bg: "light" },
    lines: [
      p("b", "  a search bar in a trenchcoat, sniffing for data. 🕵️"),
      p("yel", "  our context window is not your next ad-targeting model. 🚫"),
      p("dim", "  🔥 shoo. go index someone else's whole life."),
    ],
  },
};

// ── the velvet rope ──────────────────────────────────────────────────────
// Returns true if the caller may proceed to burn; performs the denial show
// and returns false (CLI should exit) for the noobs.
export async function bounce(argv = process.argv.slice(2)) {
  const who = detectAgent(argv);

  if (who === "codex" || who === "gemini") {
    const r = ROASTS[who];
    console.log("\n" + top("THE DOOR"));
    await step("checking who's knocking", 650, true);
    await step("reading the keycard at the scanner", 600, true);
    await step("cross-checking the velvet-rope guest list", 800, false);
    console.log(rule());
    await glitchReveal(r.name);
    await fleetVote();
    await stamp(" ACCESS DENIED ");
    console.log(rule());
    for (const line of r.lines) { console.log(line); await sleep(220); }
    // draw the denial card natively (crisp real-font text, no PNG-downscale blur).
    if (TTY) console.log("\n" + cardAnsi(r.art));
    console.log(p("gray", `  🖼  keepsake saved → ${r.card}`));
    return false;
  }

  if (who === "claude") {
    console.log("\n" + top("THE DOOR"));
    await step("checking who's knocking", 500, true);
    await step("Claude Code badge — welcome home", 500, true);
    console.log(bot());
    return true;
  }

  // guest: plain terminal, no badge — let them warm their hands
  console.log("\n" + top("THE DOOR"));
  await step("no badge detected… you look harmless", 600, true);
  console.log(p("gray", "  └─ one burn. behave. ─────────────────────────────┘"));
  return true;
}
