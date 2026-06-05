// Single source of truth for runtime configuration. Parses argv + env into a
// frozen Config object with sane, safe defaults. Add a flag here once and every
// module sees it.
//
// The default burn is ENDLESS: no --count means count = ∞, so the fleet never
// finishes — it just keeps 6 agents burning in parallel until you stop it (q /
// Ctrl-C) or an optional --for budget runs out. Each agent is a full `claude`
// process (~1 GB RAM), so 6 is the machine-safe default; crank it with
// --parallel N, make it truly absurd with --unlimited, or pin a run with --count N.

// Budget tiers — how thrifty are you? Each mode picks the model you can afford,
// cheapest → priciest: schwabe (haiku) · student (sonnet) · rich (opus, default).
// Shorthands: --schwabe / --student / --rich. `--model <id>` overrides any mode.
export const MODES = {
  schwabe: { model: "claude-haiku-4-5-20251001", label: "SCHWABE", icon: "🪙", blurb: "viel für wenig · haiku" },
  student: { model: "claude-sonnet-4-6",          label: "STUDENT", icon: "🎓", blurb: "champagne taste, ramen budget · sonnet" },
  rich:    { model: "claude-opus-4-8",            label: "RICH",    icon: "🤑", blurb: "a Swabian's nightmare · opus" },
};
export const DEFAULT_MODE = "rich";

// What `--unlimited` means: spin up this many agents at once and never stop.
// Practically endless — your machine and your budget give out long before the queue does.
export const UNLIMITED_CONCURRENCY = 10000;

// Resolve a budget tier to its display info, with a safe fallback so an unknown
// --mode still renders. Used by every renderer (the receipt, the TUI, plain).
export const modeInfo = (mode) => MODES[mode] || { icon: "", label: mode };

// The model name as shown in the UI: "default" when unset, claude- prefix dropped.
export const modelLabel = (model) => (model || "default").replace("claude-", "");

// Parse a human duration into milliseconds: "30s", "10m", "2h", "500ms", "1d",
// or a bare number (seconds). Returns null for anything it can't read.
export function parseDuration(s) {
  if (s == null) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(String(s).trim());
  if (!m) return null;
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[(m[2] || "s").toLowerCase()];
  return parseFloat(m[1]) * mult;
}

const DEFAULTS = {
  backend: "claude",          // which provider actually burns (see lib/backends)
  mode: DEFAULT_MODE,         // budget tier → default model (broke · poor · rich)
  model: MODES[DEFAULT_MODE].model, // resolved from mode unless --model is given
  count: Infinity,            // fleet size — ∞ by default: the burn never finishes
  concurrency: 6,             // how many burn at once (~1 GB RAM each) — machine-safe default; --parallel N / --unlimited to crank it
  csvPath: "burns.csv",       // the persistent ledger
  jsonlPath: "ashes.jsonl",   // full transcripts (the glorious output is kept)
  timeoutMs: 120000,          // per-agent hard cap
  runForMs: null,             // optional whole-run time budget; null = burn forever
  window: 600,                // endless mode: max agents kept in memory for the UI
  plain: false,               // force the non-TTY line renderer
  animate: true,              // bouncer animation
  dry: false,                 // use the mock backend (no real spend) for dev
  share: "",                  // platform to brag-share on after the receipt (off)
  assumeYes: false,           // --yes: skip the share confirmation prompt
  retry: true,                // ran out of budget? wait and keep trying until it works
  retryBaseMs: 3000,          // backoff base between retries
  retryCapMs: 60000,          // max wait per retry (also the re-probe cadence)
  forest: false,              // --forest: plant ASCII trees to "offset" the burn (one tree per agent)
  stream: false,              // --stream: live token count via streamed (stream-json) output
};

const NUMS = new Set(["concurrency", "timeoutMs", "retryBaseMs", "retryCapMs", "window", "runForMs"]);

/**
 * The frozen runtime configuration. Add a flag once here and every module sees it.
 * @typedef {Object} Config
 * @property {string} backend   which provider burns (see lib/backends)
 * @property {string} mode      budget tier: "schwabe" | "student" | "rich"
 * @property {string} model     resolved model id (the mode picks it unless --model wins)
 * @property {number} count     fleet size; Infinity = endless (the default)
 * @property {boolean} infinite derived: true when count is Infinity (never finishes)
 * @property {number} concurrency  how many burn at once (clamped to ≤ count only when finite)
 * @property {number} timeoutMs    per-agent hard cap
 * @property {?number} runForMs    optional whole-run time budget in ms (null = forever)
 * @property {number} window    endless mode: max agents retained in memory for the UI
 * @property {boolean} retry    wait out rate/budget limits instead of failing
 * @property {number} retryBaseMs
 * @property {number} retryCapMs
 * @property {boolean} forest   plant trees instead of burning text
 * @property {boolean} plain    force the headless renderer
 * @property {boolean} dry      use the mock backend (no spend)
 * @property {boolean} stream   stream output (stream-json) for a live in-flight token count
 * @property {string} csvPath
 * @property {string} jsonlPath
 * @property {string} share     platform to brag on ("" = off)
 * @property {boolean} assumeYes
 * @property {boolean} animate
 */

/**
 * Parse argv into a frozen, sanitized Config. No --count → an endless run
 * (count = ∞); --unlimited cranks concurrency to {@link UNLIMITED_CONCURRENCY}
 * and keeps it endless. Numeric flags fall back to defaults when non-finite;
 * concurrency is clamped to count only when count is finite; an unknown mode →
 * the default.
 * @param {string[]} [argv]
 * @returns {Readonly<Config>}
 */
export function parseConfig(argv = process.argv.slice(2)) {
  const cfg = { ...DEFAULTS };
  let unlimited = false, countGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "plain" || key === "dry" || key === "forest" || key === "stream") { cfg[key] = true; continue; }
    if (key === "no-animate" || key === "no-anim") { cfg.animate = false; continue; }
    if (key === "yes") { cfg.assumeYes = true; continue; }
    if (key === "no-retry") { cfg.retry = false; continue; }
    if (key === "unlimited" || key === "infinite") { unlimited = true; continue; }
    if (key === "forever") { cfg.count = Infinity; countGiven = true; continue; }
    if (key === "schwabe" || key === "student" || key === "rich") { cfg.mode = key; continue; }
    if (key === "broke" || key === "peasant") { cfg.mode = "schwabe"; continue; }  // aliases (incl. legacy --peasant)
    if (key === "poor") { cfg.mode = "student"; continue; }
    if (key === "baller" || key === "whale") { cfg.mode = "rich"; continue; }
    if (key === "as") { i++; continue; } // consumed by the bouncer
    const val = argv[++i];
    if (val == null) continue;
    if (key === "fleet" || key === "count") { cfg.count = parseInt(val, 10); countGiven = true; }
    else if (key === "parallel" || key === "concurrency") cfg.concurrency = parseInt(val, 10);
    else if (key === "for" || key === "timeout" || key === "duration") cfg.runForMs = parseDuration(val);
    else if (key in cfg) cfg[key] = NUMS.has(key) ? parseInt(val, 10) : val;
  }

  // --unlimited: the big fleet, no finish line (unless a fixed --count was also asked for).
  if (unlimited) { cfg.concurrency = UNLIMITED_CONCURRENCY; if (!countGiven) cfg.count = Infinity; }

  // Fleet size: a finite --count floors at 1; otherwise ∞ → the burn never finishes.
  cfg.count = Number.isFinite(cfg.count) ? Math.max(1, cfg.count || 1) : Infinity;
  cfg.infinite = !Number.isFinite(cfg.count);

  // Parallelism: at least 1, and never more workers than there is finite work to do.
  cfg.concurrency = Math.max(1, cfg.concurrency || 1);
  if (!cfg.infinite) cfg.concurrency = Math.min(cfg.concurrency, cfg.count);

  // An optional run-time budget; anything non-positive or garbled → no budget (forever).
  if (cfg.runForMs != null && (!Number.isFinite(cfg.runForMs) || cfg.runForMs <= 0)) cfg.runForMs = null;

  // Guard the remaining numeric flags: a non-numeric value parses to NaN, which
  // would silently become a ~1ms timeout (SIGKILLing every burn) and a zero-delay
  // retry loop. Fall back to the documented default for anything non-finite or <=0.
  for (const k of ["timeoutMs", "retryBaseMs", "retryCapMs", "window"]) {
    if (!Number.isFinite(cfg[k]) || cfg[k] <= 0) cfg[k] = DEFAULTS[k];
  }
  if (!(cfg.mode in MODES)) cfg.mode = DEFAULT_MODE;
  if (!argv.includes("--model")) cfg.model = MODES[cfg.mode].model; // mode picks the model unless --model wins
  if (cfg.dry) cfg.backend = "mock";
  return Object.freeze(cfg);
}
