// Builds the fleet's marching orders. Each agent gets one absurd task and is
// ordered to commit to it completely — gloriously over-the-top, never half-hearted.

import { TASKS, ADJECTIVES } from "./tasks.js";
import { buildTreePrompt, speciesFor } from "../forest/index.js";

const SYSTEM_VIBE =
  "You are one agent in a Token Burner fleet. A human's token limit just reset " +
  "and they intend to use every last token they already paid for. Produce " +
  "something gloriously over-the-top and funny — fully committed, specific, a " +
  "little unhinged. No preamble, no meta-commentary, no explaining the joke. " +
  "Just the bit (30-70 words).";

// Roughly 1 in 5 agents gets the smug streak — insufferably proud of wringing
// every last drop of value out of tokens that would otherwise have expired. The
// rest stay light.
const SMUG =
  " Also be smugly, insufferably proud of squeezing every last drop of value out " +
  "of these tokens before they expire — pure Swabian thrift energy.";

/**
 * One agent's marching orders, as consumed by the Fleet and recorded in the ledger.
 * @typedef {Object} Task
 * @property {string} id      zero-padded agent id, e.g. "007"
 * @property {string} label   short task description (for the UI + ledger)
 * @property {string} adj     the absurd adverb (burn mode; "" in forest mode)
 * @property {string} prompt  the full prompt sent to the backend
 * @property {number} [treeIndex]  the agent's slot in the forest grid (forest mode)
 * @property {string} [species]    the species to plant (forest mode)
 */

/**
 * One absurd burn task for the agent at zero-based index `i`. The single-agent
 * factory the endless fleet pulls on demand — id, task and adjective all cycle
 * their tables, with a ~1-in-5 smug streak. `buildTasks` just maps it over a range.
 * @param {number} i  zero-based agent index
 * @returns {Task}
 */
export function buildTask(i) {
  const id = String(i + 1).padStart(3, "0");
  const task = TASKS[i % TASKS.length];
  const adj = ADJECTIVES[((i + 1) * 7) % ADJECTIVES.length];
  const vibe = Math.random() < 0.2 ? SYSTEM_VIBE + SMUG : SYSTEM_VIBE;
  return {
    id,
    label: task,
    adj,
    prompt: `${vibe}\n\nYour assignment, agent-${id}: ${task} — ${adj}.`,
  };
}

/**
 * Build a fixed batch of `count` burn tasks (for a finite --count run).
 * @param {number} count
 * @returns {Task[]}
 */
export function buildTasks(count) {
  return Array.from({ length: count }, (_, i) => buildTask(i));
}

// 🌲 Reforestation orders: each agent plants one ASCII tree. `treeIndex` is its
// slot in the (square) forest; `species` is cycled for variety.
/**
 * One tree-planting task for the agent at zero-based index `i` (--forest mode).
 * The single-agent factory the endless fleet pulls on demand.
 * @param {number} i  zero-based agent / tree-slot index
 * @returns {Task}
 */
export function buildForestTask(i) {
  const id = String(i + 1).padStart(3, "0");
  const species = speciesFor(i);
  return {
    id,
    label: `plant a ${species}`,
    adj: "",
    treeIndex: i,
    species,
    prompt: buildTreePrompt(species),
  };
}

/**
 * Build a fixed batch of `count` tree-planting tasks (for a finite --count run).
 * @param {number} count
 * @returns {Task[]}
 */
export function buildForestTasks(count) {
  return Array.from({ length: count }, (_, i) => buildForestTask(i));
}
