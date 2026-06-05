// Headless renderer for non-TTY / piped / CI. No cursor games — just a line per
// finished agent and a final summary. Same interface as the TUI (start/stop).

import { C, paint, nf, usd } from "../core/util.js";
import { modeInfo, modelLabel } from "../core/config.js";

export class PlainRenderer {
  constructor(fleet, metrics, cfg, forest = null) {
    this.fleet = fleet;
    this.metrics = metrics;
    this.cfg = cfg;
    this.forest = forest;
  }

  start() {
    const { cfg, fleet, forest } = this;
    const mode = modeInfo(cfg.mode);
    if (fleet.infinite) {
      // Endless: no fixed agent count — just the parallel width and "forever".
      const what = forest ? "planting trees" : "burning";
      console.log(paint(C.yellow, `\n${mode.icon} ${mode.label} mode · ${what} forever via ${cfg.backend} (${modelLabel(cfg.model)}), ${cfg.concurrency} in parallel · q / Ctrl-C to stop\n`));
    } else {
      const what = forest ? `planting ${fleet.agents.length} trees to "offset" the burn with` : "burning";
      console.log(paint(C.yellow, `\n${mode.icon} ${mode.label} mode · ${what} ${fleet.agents.length} agents via ${cfg.backend} (${modelLabel(cfg.model)}), ${cfg.concurrency} at a time…\n`));
    }
    fleet.on("agent:wait", ({ agent, waitMs, attempt }) => {
      console.log(`  ${paint(C.yellow, "⏳")} agent-${agent.id}  ${paint(C.yellow, "rate-limited")} — retry #${attempt} in ${Math.ceil(waitMs / 1000)}s ${paint(C.dim, "(keeping the fire lit)")}`);
    });
    fleet.on("agent:done", ({ agent, result }) => {
      this.metrics.tick();
      const mark = result.ok ? paint(C.green, "✓") : paint(C.red, "✗");
      const toks = paint(C.cyan, nf(agent.tokens).padStart(8) + " tok");
      const tag = result.estimated ? paint(C.gray, " ~est") : "";
      // Endless runs have no denominator — show the running tally instead of "/N".
      if (forest && result.ok) {
        const tally = fleet.infinite ? `${forest.planted} trees` : `${forest.planted}/${fleet.agents.length} trees`;
        console.log(`  ${paint(C.green, "🌳")} agent-${agent.id} planted ${paint(C.green, agent.species)} ${paint(C.dim, `(${tally})`)}  ${toks}${tag}`);
        return;
      }
      const progress = fleet.infinite ? nf(fleet.completed) : `${fleet.done}/${fleet.agents.length}`;
      const note = result.ok ? paint(C.gray, agent.label) : paint(C.red, result.error || "error");
      console.log(`  ${mark} agent-${agent.id}  ${toks}${tag}  ${paint(C.dim, progress)}  ${note}`);
      // Heartbeat every 100 burns so a long endless run shows it's still alive.
      if (fleet.infinite && fleet.completed > 0 && fleet.completed % 100 === 0) {
        console.log(paint(C.yellow, `  🔥 ${nf(fleet.completed)} burned · ${nf(this.metrics.tokens)} tokens · ${usd(this.metrics.runCost)} · still going`));
      }
    });
  }

  stop() {}
}
