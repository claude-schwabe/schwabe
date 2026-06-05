// Public entry for the forest domain. Re-exports the species data + CO₂ math,
// the single-tree helpers (dimensions, prompt, parser), and the Forest aggregate,
// so the rest of the app imports one stable path: lib/forest/index.js.

export * from "./species.js";
export * from "./tree.js";
export * from "./forest.js";
