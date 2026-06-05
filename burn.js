#!/usr/bin/env node
// 🔥🔥🔥  T O K E N   B U R N E R  🔥🔥🔥
// Your limit just reset. This actually spawns agents, burns REAL tokens, logs
// every one to burns.csv, and shows it in a btop-style live terminal dashboard.
//
//   ./burn.js                         # burn tokens on gloriously absurd text
//   ./burn.js --forest                # plant a virtual forest to "offset" it
//   ./burn.js --count 108 --schwabe   # bigger fleet, cheap model
//   ./burn.js --dry                   # mock backend, no spend, same UI
//   ./burn.js --plain                 # headless line output (no TUI)

import { parseConfig, modeInfo, modelLabel } from "./lib/core/config.js";
import { bounce } from "./lib/door/bouncer.js";
import { resolveBackend, availableBackends } from "./lib/backends/index.js";
import { buildTasks, buildForestTasks, buildTask, buildForestTask } from "./lib/engine/prompts.js";
import { Forest, parseTree } from "./lib/forest/index.js";
import { Ledger, loadLifetime } from "./lib/engine/ledger.js";
import { Metrics } from "./lib/engine/metrics.js";
import { Fleet } from "./lib/engine/fleet.js";
import { TuiRenderer } from "./lib/ui/tui.js";
import { PlainRenderer } from "./lib/ui/plain.js";
import { ASH_FACTS } from "./lib/engine/tasks.js";
import { resolvePlatform, listPlatforms } from "./lib/integrations/index.js";
import { shareRun } from "./lib/integrations/share.js";
import { C, RESET, paint, nf, usd, hms, fire, now, initTheme } from "./lib/core/util.js";

const cfg = parseConfig();

await initTheme();   // adapt colors to a light or dark terminal

// 🚪 card everyone at the door before a single token burns.
if (!(await bounce())) process.exit(13);

let backend;
try {
  backend = await resolveBackend(cfg.backend);
} catch (e) {
  console.error(paint(C.red, `\n  ✗ ${e.message}`));
  console.error(paint(C.gray, `  available right now: ${(await availableBackends()).join(", ") || "none"}\n`));
  process.exit(1);
}

const runId = "run-" + now().toString(36);

// 🌲 reforestation: each agent plants one ASCII tree into a growing FOREST.txt.
const forest = cfg.forest ? new Forest() : null;
if (forest) forest.plan(cfg.infinite ? 0 : cfg.count);  // endless: nothing to pre-allocate

const ledger = new Ledger({ csvPath: cfg.csvPath, jsonlPath: cfg.jsonlPath, runId, model: cfg.model, backend: cfg.backend });
const metrics = new Metrics(loadLifetime(cfg.csvPath));
// Endless by default: the pool pulls fresh tasks from a factory forever. A finite
// --count builds the whole batch up front (old behavior).
const fleet = cfg.infinite
  ? new Fleet({ backend, cfg, makeTask: cfg.forest ? buildForestTask : buildTask, total: Infinity })
  : new Fleet({ backend, cfg, tasks: cfg.forest ? buildForestTasks(cfg.count) : buildTasks(cfg.count) });

fleet.on("agent:done", ({ agent, result }) => {
  ledger.record(agent, result);
  metrics.add(result);
  if (forest && result.ok) { forest.plant(agent.treeIndex, parseTree(result.text), agent.species, agent.tokens); forest.flush(); }
});
if (forest) fleet.on("agent:start", (agent) => forest.setStatus(agent.treeIndex, "growing"));

const useTui = process.stdout.isTTY && !cfg.plain;
let printed = false;
const renderer = useTui
  ? new TuiRenderer(fleet, metrics, cfg, () => { renderer.stop(); receipt(true); process.exit(130); }, forest)
  : new PlainRenderer(fleet, metrics, cfg, forest);

fleet.startedAt = Date.now();
// Optional whole-run budget: when it elapses, wind the fleet down gracefully
// (in-flight agents drain, then the receipt prints) instead of a hard kill.
const stopTimer = cfg.runForMs ? setTimeout(() => fleet.stop(), cfg.runForMs) : null;
renderer.start();
try {
  await fleet.run();
} finally {
  if (stopTimer) clearTimeout(stopTimer);
  renderer.stop();
}
if (forest) {
  forest.flush(true);
  // An endless run can hold thousands of trees; the receipt's certificate carries
  // the lifetime tally, so only a finite run prints the whole grid here.
  if (!cfg.infinite) console.log("\n" + forest.renderForest());
}
receipt(false);
await brag();

// ── brag against your better judgment (prints a link — never opens a browser) ─
async function brag() {
  const survivor = fleet.agents.find((a) => a.status === "done" && a.result?.text);
  const line = survivor ? survivor.result.text.replace(/\s+/g, " ").trim().slice(0, 60) : null;
  const summary = { tokens: metrics.tokens, cost: metrics.runCost, agents: metrics.totals.ok, line };

  if (cfg.share) {
    let platform;
    try { platform = resolvePlatform(cfg.share); }
    catch (e) { console.error(paint(C.red, `  ✗ ${e.message}`)); return; }
    await shareRun({ platform, summary, assumeYes: cfg.assumeYes });
    return;
  }
  const plats = listPlatforms();
  const pick = plats[metrics.totals.ok % plats.length];
  console.log(paint(C.dim, `  brag about it: node share.js ${pick}\n`));
}

// ── the cremation receipt ────────────────────────────────────────────────
function receipt(aborted) {
  if (printed) return;
  printed = true;
  const m = metrics, t = m.totals;
  const infinite = !Number.isFinite(fleet.total);
  const elapsed = (fleet.finishedAt || Date.now()) - fleet.startedAt;
  const est = !backend.metered;   // unmetered backends report estimated figures
  const stupid = fleet.agents.filter((a) => a.status === "done" && a.result?.text).slice(0, 2);

  const L = [];
  L.push("");
  L.push(fire("  ════════════ CREMATION RECEIPT ════════════"));
  if (aborted) L.push(paint(C.red, infinite
    ? "  (stopped — fresh tokens await at the next reset)"
    : "  (aborted early — the rest of the tank survives)"));
  L.push(paint(C.yellow, "   tokens incinerated : ") + paint(C.red, nf(m.tokens)) + (est ? paint(C.gray, "  (~est)") : ""));
  L.push(paint(C.yellow, "   of which output    : ") + nf(t.output));
  L.push(paint(C.yellow, "   real cost (usd)     : ") + paint(C.green, usd(m.runCost)) + (est ? paint(C.gray, "  (unmetered backend)") : ""));
  L.push(paint(C.yellow, "   agents              : ") + `${t.ok}/${infinite ? fleet.completed : fleet.agents.length}` + (t.errors ? paint(C.red, `  (${t.errors}✗)`) : ""));
  const mode = modeInfo(cfg.mode);
  L.push(paint(C.yellow, "   mode / engine       : ") + `${mode.icon} ${paint(C.bold, mode.label)} · ${backend.label} · ${modelLabel(cfg.model)}`);
  L.push(paint(C.yellow, "   wall-clock          : ") + hms(elapsed));
  L.push(paint(C.yellow, "   ledger              : ") + paint(C.cyan, cfg.csvPath) + paint(C.gray, `  · transcripts → ${cfg.jsonlPath}`));
  if (forest) {
    L.push(paint(C.yellow, "   reforestation       : ") + paint(C.green, `🌲 ${forest.planted} trees planted this run`) + paint(C.gray, `  · ${forest.lifetimeTrees} lifetime · ${forest.txtPath}`));
  }
  L.push(paint(C.yellow, "   all-time burned     : ") + paint(C.mag, `${nf(m.allTimeTokens)} tok · ${usd(m.allTimeCost)} across ${m.allTimeBurns} burns`));
  L.push(fire("  ════════════════════════════════════════════"));
  if (forest) {
    for (const cl of forest.certificate().split("\n")) L.push(paint(C.green, "  " + cl));
  } else {
    for (const a of stupid) {
      const txt = a.result.text.replace(/\s+/g, " ").trim().slice(0, 90);
      L.push(paint(C.gray, `   agent-${a.id}: `) + paint(C.dim, `"${txt}${txt.length >= 90 ? "…" : ""}"`));
    }
  }
  L.push(paint(C.dim, `\n   “${ASH_FACTS[Math.floor(Math.random() * ASH_FACTS.length)]}”`));
  L.push(paint(C.gray, "   0% left. see you at the next reset. 🔥") + RESET + "\n");
  console.log(L.join("\n"));
}
