// Mock backend for `--dry` runs: exercises the whole pipeline (fleet, ledger,
// metrics, TUI) with NO real spend. Clearly flagged estimated so nobody mistakes
// it for real data. Default runs never use this.

import { estimateTokens, emptyUsage } from "./base.js";
import { FOREST_MARKER, TREE_W } from "../forest/index.js";

// A canned little fake tree so `--forest --dry` exercises the forest with no spend.
const mockTree = () => [
  "      /\\       ", "     /  \\      ", "    /^^^^\\     ",
  "   /^^^^^^\\    ", "  /^^^^^^^^\\   ", " /^^^^^^^^^^\\  ",
  "      ||       ", "      ||       ", "     /||\\      ",
].map((l) => l.padEnd(TREE_W).slice(0, TREE_W)).join("\n");

const ABSURD = [
  "the semicolon went to therapy and came back even more conflicted.",
  "i counted to infinity twice; the second time was for spite.",
  "water is wet only on weekdays, this has been peer-reviewed by me.",
  "a 404 page walked into a bar. the bar was not found.",
  "i taught a regex to love. it left me for a wildcard.",
];

// TB_FAIL_FIRST=N makes the first N run() calls fail with a simulated rate-limit
// so the retry/recovery path can be tested without a real budget wipeout.
let _calls = 0;
const FAIL_FIRST = Number(process.env.TB_FAIL_FIRST || 0);

export const mock = {
  name: "mock",
  label: "Mock (dry)",
  cmd: "mock",
  metered: false, // estimated figures only — matches the makeBackend() shape
  available: async () => true,
  // onProgress (when given) streams a rising output-token estimate over the fake
  // delay, so `--dry` shows the live counter tick up exactly like a real stream.
  async run(prompt, _cfg, onProgress) {
    if (++_calls <= FAIL_FIRST) {
      await new Promise((r) => setTimeout(r, 150));
      return {
        ok: false, durationMs: 150, text: "", costUsd: 0, estimated: true,
        usage: emptyUsage(),
        error: "rate limit exceeded — five_hour budget used up, try again later",
        raw: "simulated 429 rate_limit overage rejected",
        resetAt: Math.floor(Date.now() / 1000) + 2,
      };
    }
    const text = prompt.includes(FOREST_MARKER) ? mockTree()
      : ABSURD[Math.floor(Math.random() * ABSURD.length)];
    const outputTokens = estimateTokens(text) + Math.floor(Math.random() * 300);
    const delay = 200 + Math.floor(Math.random() * 600);
    if (onProgress) {
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, delay / steps));
        onProgress(Math.round((outputTokens * i) / steps)); // climb toward the final output count
      }
    } else {
      await new Promise((r) => setTimeout(r, delay));
    }
    return {
      ok: true,
      durationMs: delay,
      text,
      estimated: true,
      costUsd: 0,
      usage: {
        inputTokens: estimateTokens(prompt),
        outputTokens,
        cacheReadTokens: 1000 + Math.floor(Math.random() * 4000),
        cacheCreationTokens: Math.floor(Math.random() * 2000),
      },
    };
  },
};
