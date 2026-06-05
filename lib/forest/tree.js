// 🌲 One tree: the fixed-size cell it must fit, the prompt that asks an agent to
// draw it, and the parser that normalizes the agent's ASCII back into that cell.

export const TREE_W = 24;   // a generous cell — room for a detailed, custom tree…
export const TREE_H = 14;   // …while staying a fixed block so the forest grid aligns
export const ROW_GAP = 1;   // spaces between trees in a row
export const FOREST_MARKER = "[[PLANT-TREE]]";  // lets the mock backend fake a tree for --dry

export function buildTreePrompt(species) {
  return [
    FOREST_MARKER,
    `You are a master ASCII artist. Draw a striking, distinct ${species} with a strong 3D, VOLUMETRIC look — light it from the upper-left so the canopy reads as a round ball and the trunk as a cylinder: bright highlights on the lit (upper-left) side, dark shadow on the lower-right, a cast shadow at the base. Be creative; no two trees should look alike.`,
    `It must fit a ${TREE_W}×${TREE_H} character cell: output EXACTLY ${TREE_H} lines, each padded with spaces to EXACTLY ${TREE_W} characters, the trunk near the bottom and the tree roughly centered.`,
    `Shade with a gradient that suggests depth: light marks ( \` ' . , : ; ) for highlights, mid ( ~ ^ * o % ) for form, dark ( # & @ ) for shadow and the trunk; spaces for empty sky.`,
    `Output ONLY the ${TREE_H} lines — no commentary, no code fences, no labels.`,
  ].join("\n");
}

// Always returns exactly TREE_H lines of exactly TREE_W chars (leading spaces
// preserved so the tree keeps its position; never throws).
export function parseTree(text) {
  const lines = String(text || "").replace(/```/g, "").split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const box = lines.slice(0, TREE_H);
  while (box.length < TREE_H) box.push("");
  return box.map((l) => l.padEnd(TREE_W).slice(0, TREE_W));
}
