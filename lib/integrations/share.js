// The brag orchestrator. Takes a run `summary`, picks a `platform` spec, scares
// the user with a FAT red warning box about what that platform does to their
// data, asks for consent, then builds and PRINTS a prefilled share URL.
//
// Safety rails:
//   - NEVER opens a browser — it only ever prints the link (you press the button).
//   - `assumeYes` skips the stdin prompt (for --yes / CI).
//   - The final URL is ALWAYS printed.

import { createInterface } from "node:readline";
import { C, RESET, paint, nf, visLen } from "../core/util.js";
import { box } from "../ui/widgets.js";
import { resolvePlatform } from "./index.js";

export const DEFAULT_LINK = "https://github.com/claude-schwabe/schwabe";

// One braggy one-liner to crown the post. Cycled, not random-critical.
const BRAGS = [
  "every token earned its keep",
  "100% utilization, nothing left to expire",
  "i used every token i paid for, down to the last one",
  "full value extracted, nichts verschwendet",
  "this is what getting your money's worth looks like",
];

// Build the short, braggy caption from a run summary. Brand mentioned: schwabe.
export function buildShareText(summary = {}) {
  const tokens = nf(summary.tokens || 0);
  const agents = summary.agents || 0;
  const brag = summary.line || BRAGS[(summary.agents || 0) % BRAGS.length];
  return (
    `🔥 schwabe just put ${tokens} tokens to work across ${agents} AI agents — ` +
    `${brag}. 🔥 #schwabe`
  );
}

// The doom box. Big, red, skull-forward. Returns lines; caller prints them.
function warningBox(platform, width) {
  const w = Math.max(48, Math.min(width || 64, 72));
  const wrapped = wrap(platform.warning, w - 4);
  const lines = [
    paint(C.yellow, "📣  heads up before you post:"),
    "",
    ...wrapped.map((l) => paint(C.yellow, l)),
  ];
  return box({
    title: paint(C.red, `📣  POSTING TO ${platform.label.toUpperCase()}`),
    width: w,
    lines,
    color: C.red,
    footer: paint(C.gray, "a prefilled link — you still press the button"),
  });
}

// Tiny word-wrap (ANSI-aware enough for plain warning strings).
function wrap(s, width) {
  const words = String(s).split(/\s+/);
  const out = [];
  let line = "";
  for (const word of words) {
    if (line && visLen(line) + 1 + visLen(word) > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim().toLowerCase());
    });
  });
}

// Main entry. `summary` = { tokens, cost, agents, line? }.
export async function shareRun({
  platform,
  summary = {},
  link = DEFAULT_LINK,
  assumeYes = false,
}) {
  const spec = typeof platform === "string" ? resolvePlatform(platform) : platform;
  const width = process.stdout.columns || 64;

  console.log("");
  for (const ln of warningBox(spec, width)) console.log(ln);
  console.log("");

  if (!assumeYes) {
    const answer = await ask(paint(C.red, `   post your schwabe flex to ${spec.label}? `) + paint(C.gray, "(y/N) "));
    if (answer !== "y" && answer !== "yes") {
      console.log(paint(C.green, "\n   smart. your data lives another day. 🛡️\n"));
      return { shared: false, url: null };
    }
  } else {
    console.log(paint(C.gray, `   --yes given; proceeding to ${spec.label} (your funeral).`));
  }

  const text = buildShareText({ ...summary, line: summary.line });
  const url = spec.buildUrl(text, link);

  console.log("");
  if (spec.manual) {
    console.log(paint(C.mag, `   ${spec.label} has no web share — copy this caption and post it by hand:`));
    console.log(paint(C.dim, `   "${text}"`));
  } else if (spec.textOnly) {
    console.log(paint(C.mag, `   ${spec.label} only takes the link — paste this caption yourself:`));
    console.log(paint(C.dim, `   "${text}"`));
  }

  console.log(paint(C.gray, "   (not opening a browser — your caption's ready to paste)"));
  console.log(paint(C.cyan, `   → ${url}`) + RESET + "\n");
  return { shared: true, url, text };
}
