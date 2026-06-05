// Unit tests for lib/forest/index.js — the virtual reforestation module. Covers the
// pure helpers (co2For, speciesFor, emittedKg, buildTreePrompt, parseTree) and
// the Forest class (plan/setStatus/plant, the lifetime/run getters, savings &
// emissions math, colsFor grid sizing, renderForest, certificate/toDocument,
// flush throttling, and _loadPrior via a pre-seeded dataPath). Every filesystem
// path is routed through tmp() so nothing ever touches the real FOREST.txt /
// forest.jsonl in the repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmp } from "./helpers.js";
import {
  TREE_W, TREE_H, ROW_GAP, FOREST_MARKER, SPECIES_CO2, DEFAULT_CO2,
  co2For, SPECIES, speciesFor, emittedKg, buildTreePrompt, parseTree, Forest,
} from "../lib/forest/index.js";

// ── module constants ───────────────────────────────────────────────────────
test("constants have their documented shape", () => {
  assert.equal(TREE_W, 24);
  assert.equal(TREE_H, 14);
  assert.equal(ROW_GAP, 1);
  assert.equal(FOREST_MARKER, "[[PLANT-TREE]]");
  assert.equal(DEFAULT_CO2, 21);
  assert.ok(SPECIES.length > 1, "more than one species so cycling is meaningful");
  assert.deepEqual(SPECIES, Object.keys(SPECIES_CO2), "SPECIES is the table's keys");
});

// ── co2For ───────────────────────────────────────────────────────────────
test("co2For returns the table value for a known species", () => {
  assert.equal(co2For("oak"), 22);
  assert.equal(co2For("redwood"), 312);
  assert.equal(co2For("bonsai"), 1);
});

test("co2For is case-insensitive", () => {
  assert.equal(co2For("OAK"), SPECIES_CO2.oak);
  assert.equal(co2For("Cherry Blossom"), SPECIES_CO2["cherry blossom"]);
});

test("co2For falls back to DEFAULT_CO2 for an unknown / empty / null species", () => {
  assert.equal(co2For("definitely-not-a-tree"), DEFAULT_CO2);
  assert.equal(co2For(""), DEFAULT_CO2);
  assert.equal(co2For(null), DEFAULT_CO2);
  assert.equal(co2For(undefined), DEFAULT_CO2);
});

// ── speciesFor ─────────────────────────────────────────────────────────────
test("speciesFor indexes directly within range", () => {
  assert.equal(speciesFor(0), SPECIES[0]);
  assert.equal(speciesFor(1), SPECIES[1]);
});

test("speciesFor cycles modulo SPECIES.length", () => {
  assert.equal(speciesFor(SPECIES.length), SPECIES[0]);
  assert.equal(speciesFor(SPECIES.length + 1), SPECIES[1]);
  assert.equal(speciesFor(SPECIES.length * 3 + 2), SPECIES[2]);
});

// ── emittedKg ──────────────────────────────────────────────────────────────
test("emittedKg is tokens/1000 * 0.0042", () => {
  assert.equal(emittedKg(0), 0);
  assert.equal(emittedKg(1000), 0.0042);
  assert.equal(emittedKg(2000), 0.0084);
  assert.equal(emittedKg(500), (500 / 1000) * 0.0042);
});

// ── buildTreePrompt ────────────────────────────────────────────────────────
test("buildTreePrompt includes the marker, the species, and the cell dims", () => {
  const p = buildTreePrompt("oak");
  assert.ok(p.includes(FOREST_MARKER), "carries the forest marker");
  assert.ok(p.includes("oak"), "names the species");
  assert.ok(p.includes(String(TREE_W)), "mentions TREE_W");
  assert.ok(p.includes(String(TREE_H)), "mentions TREE_H");
  assert.ok(p.includes(`${TREE_W}×${TREE_H}`), "states the cell as W×H");
});

// ── parseTree ──────────────────────────────────────────────────────────────
const shapeOk = (box) => {
  assert.equal(box.length, TREE_H, "exactly TREE_H lines");
  for (const l of box) assert.equal(l.length, TREE_W, "each line exactly TREE_W chars");
};

test("parseTree never throws and returns the fixed block for empty / null input", () => {
  for (const input of ["", null, undefined]) {
    const box = parseTree(input);
    shapeOk(box);
    assert.ok(box.every((l) => l === " ".repeat(TREE_W)), "all-blank block");
  }
});

test("parseTree pads a short tree up to TREE_H lines", () => {
  const box = parseTree("aaa\nbbb");
  shapeOk(box);
  assert.equal(box[0], "aaa".padEnd(TREE_W));
  assert.equal(box[1], "bbb".padEnd(TREE_W));
  assert.equal(box[2], " ".repeat(TREE_W), "remaining lines are blank-padded");
});

test("parseTree truncates a too-tall input to exactly TREE_H lines", () => {
  const tall = Array.from({ length: TREE_H + 5 }, (_, i) => `r${i}`).join("\n");
  const box = parseTree(tall);
  shapeOk(box);
  assert.equal(box[0], "r0".padEnd(TREE_W));
  assert.equal(box[TREE_H - 1], `r${TREE_H - 1}`.padEnd(TREE_W));
});

test("parseTree truncates a too-wide line to exactly TREE_W chars", () => {
  const wide = "x".repeat(TREE_W + 10);
  const box = parseTree(wide);
  shapeOk(box);
  assert.equal(box[0], "x".repeat(TREE_W));
});

test("parseTree strips triple-backtick fences", () => {
  const box = parseTree("```\nhello\n```");
  shapeOk(box);
  // The ``` lines collapse to blanks and are trimmed, leaving the content line.
  assert.equal(box[0], "hello".padEnd(TREE_W));
});

test("parseTree trims blank leading and trailing lines", () => {
  const box = parseTree("\n\n  \nmid\n  \n\n");
  shapeOk(box);
  assert.equal(box[0], "mid".padEnd(TREE_W), "leading blanks dropped");
});

test("parseTree preserves leading spaces (the tree keeps its position)", () => {
  const box = parseTree("    canopy");
  shapeOk(box);
  assert.ok(box[0].startsWith("    canopy"), "leading spaces preserved");
});

// ── Forest: construction & _loadPrior ──────────────────────────────────────
const newForest = (t, opts = {}) => {
  const box = tmp();
  t.after(box.cleanup);
  return new Forest({
    txtPath: box.file("FOREST.txt"),
    dataPath: box.file("forest.jsonl"),
    ...opts,
  });
};

test("a fresh Forest with no prior data starts empty", (t) => {
  const f = newForest(t);
  assert.equal(f.planted, 0);
  assert.equal(f.lifetimeTrees, 0);
  assert.equal(f.lifetimeTokens, 0);
  assert.equal(f.runTokens, 0);
  assert.deepEqual(f.allTrees(), []);
});

test("_loadPrior reads pre-seeded JSON tree lines (and skips junk)", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const dataPath = box.file("forest.jsonl");
  writeFileSync(dataPath, [
    JSON.stringify({ species: "oak", lines: ["a"], tokens: 100 }),
    "",                                   // blank line, skipped
    "not json at all",                    // unparseable, skipped
    JSON.stringify({ species: "pine", tokens: 5 }),   // no lines array, skipped
    JSON.stringify({ species: "maple", lines: ["b"], tokens: 200 }),
    "",
  ].join("\n"));
  const f = new Forest({ txtPath: box.file("FOREST.txt"), dataPath });
  assert.equal(f.lifetimeTrees, 2, "only the two valid tree lines load");
  assert.equal(f.lifetimeTokens, 300, "prior tokens summed");
  assert.deepEqual(f.allTrees().map((x) => x.species), ["oak", "maple"]);
});

// ── Forest: plan / setStatus ────────────────────────────────────────────────
test("plan seeds N statuses; setStatus mutates in range and ignores out-of-range", (t) => {
  const f = newForest(t);
  f.plan(3);
  assert.deepEqual(f.statuses, ["seed", "seed", "seed"]);
  f.setStatus(1, "growing");
  assert.deepEqual(f.statuses, ["seed", "growing", "seed"]);
  f.setStatus(-1, "nope");
  f.setStatus(99, "nope");
  assert.deepEqual(f.statuses, ["seed", "growing", "seed"], "out-of-range is a no-op");
});

// ── Forest: plant ───────────────────────────────────────────────────────────
test("plant pushes a tree, marks status planted, and appends one JSON line", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const dataPath = box.file("forest.jsonl");
  const f = new Forest({ txtPath: box.file("FOREST.txt"), dataPath });
  f.plan(2);
  f.plant(0, ["line1"], "oak", 123);

  assert.equal(f.planted, 1);
  assert.equal(f.statuses[0], "planted");
  assert.deepEqual(f.trees[0], { species: "oak", lines: ["line1"], tokens: 123 });

  const lines = readFileSync(dataPath, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "exactly one JSON line appended");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.species, "oak");
  assert.deepEqual(rec.lines, ["line1"]);
  assert.equal(rec.tokens, 123);
  assert.ok(typeof rec.ts === "string", "stamped with a timestamp");

  f.plant(1, ["t2"], "pine", 7);
  const lines2 = readFileSync(dataPath, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines2.length, 2, "second plant appends a second line");
});

// ── Forest: getters & math ─────────────────────────────────────────────────
test("planted / runTokens / lifetime* combine prior and this-run trees", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const dataPath = box.file("forest.jsonl");
  writeFileSync(dataPath, JSON.stringify({ species: "oak", lines: ["a"], tokens: 1000 }) + "\n");
  const f = new Forest({ txtPath: box.file("FOREST.txt"), dataPath });

  assert.equal(f.planted, 0, "planted counts only this run's new trees");
  assert.equal(f.lifetimeTrees, 1, "prior tree counts toward lifetime");

  f.plan(1);
  f.plant(0, ["x"], "pine", 250);

  assert.equal(f.planted, 1);
  assert.equal(f.runTokens, 250, "runTokens excludes prior");
  assert.equal(f.lifetimeTrees, 2);
  assert.equal(f.lifetimeTokens, 1250, "prior 1000 + run 250");
  assert.equal(f.allTrees().length, 2);
});

test("runTokens / lifetimeTokens treat a missing tokens field as 0", (t) => {
  const f = newForest(t);
  f.plan(1);
  f.plant(0, ["x"], "oak");   // no tokens passed → undefined
  assert.equal(f.runTokens, 0);
  assert.equal(f.lifetimeTokens, 0);
});

test("savingsKgPerYear sums co2For over every tree (prior + run)", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const dataPath = box.file("forest.jsonl");
  writeFileSync(dataPath, JSON.stringify({ species: "redwood", lines: ["a"], tokens: 0 }) + "\n");
  const f = new Forest({ txtPath: box.file("FOREST.txt"), dataPath });
  f.plan(2);
  f.plant(0, ["x"], "oak", 0);
  f.plant(1, ["y"], "mystery-species", 0);   // unknown → DEFAULT_CO2

  // redwood 312 + oak 22 + default 21
  assert.equal(f.savingsKgPerYear(), 312 + 22 + DEFAULT_CO2);
});

test("emittedKgTotal mirrors emittedKg(lifetimeTokens)", (t) => {
  const f = newForest(t);
  f.plan(1);
  f.plant(0, ["x"], "oak", 3000);
  assert.equal(f.emittedKgTotal(), emittedKg(3000));
});

// ── Forest: colsFor ─────────────────────────────────────────────────────────
test("colsFor is ceil(sqrt(n)), at least 1", (t) => {
  const f = newForest(t);
  assert.equal(f.colsFor(0), 1, "never zero columns");
  assert.equal(f.colsFor(1), 1);
  assert.equal(f.colsFor(4), 2);
  assert.equal(f.colsFor(9), 3);
  assert.equal(f.colsFor(10), 4, "ceil(sqrt(10)) = 4");
});

test("colsFor honors an explicit cols override", (t) => {
  const f = newForest(t, { cols: 5 });
  assert.equal(f.colsFor(100), 5);
  assert.equal(f.colsFor(1), 5);
});

// ── Forest: renderForest ────────────────────────────────────────────────────
test("renderForest shows the empty-clearing message when there are no trees", (t) => {
  const f = newForest(t);
  const out = f.renderForest();
  assert.match(out, /empty clearing/);
  assert.match(out, /plant something/);
});

test("renderForest lays trees into a grid and includes their content", (t) => {
  const f = newForest(t);
  f.plan(2);
  f.plant(0, ["CANOPY-A"], "oak", 1);
  f.plant(1, ["CANOPY-B"], "pine", 1);
  const out = f.renderForest();
  assert.ok(out.includes("CANOPY-A"), "first tree content present");
  assert.ok(out.includes("CANOPY-B"), "second tree content present");
  // 2 trees → ceil(sqrt(2)) = 2 cols → one row → TREE_H tree lines + 1 ground line.
  assert.equal(out.split("\n").length, TREE_H + 1);
});

test("renderForest accepts an explicit trees argument", (t) => {
  const f = newForest(t);
  const out = f.renderForest([{ species: "oak", lines: ["SOLO-TREE"] }]);
  assert.ok(out.includes("SOLO-TREE"));
});

// ── Forest: certificate / toDocument ────────────────────────────────────────
test("certificate is a string carrying the savings header and labels", (t) => {
  const f = newForest(t);
  f.plan(1);
  f.plant(0, ["x"], "oak", 1000);
  const cert = f.certificate();
  assert.equal(typeof cert, "string");
  assert.match(cert, /VIRTUAL CO₂ SAVINGS/);
  assert.match(cert, /trees planted \(lifetime\)/);
  assert.match(cert, /tokens burned to plant them/);
  assert.match(cert, /virtual CO₂ savings/);
  assert.match(cert, /real CO₂ emitted/);
});

test("toDocument wraps the certificate and forest with the document header", (t) => {
  const f = newForest(t);
  f.plan(1);
  f.plant(0, ["TREEBODY"], "oak", 1);
  const doc = f.toDocument();
  assert.equal(typeof doc, "string");
  assert.match(doc, /YOUR VIRTUAL FOREST/);
  assert.ok(doc.includes(f.certificate()), "embeds the certificate");
  assert.ok(doc.includes("TREEBODY"), "embeds the rendered forest");
});

// ── Forest: flush ───────────────────────────────────────────────────────────
test("flush(true) writes the document to txtPath and returns the path", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const txtPath = box.file("FOREST.txt");
  const f = new Forest({ txtPath, dataPath: box.file("forest.jsonl") });
  f.plan(1);
  f.plant(0, ["WRITTEN-TREE"], "oak", 1);

  const returned = f.flush(true);
  assert.equal(returned, txtPath);
  assert.ok(existsSync(txtPath), "file written");
  assert.equal(readFileSync(txtPath, "utf8"), f.toDocument());
  assert.ok(readFileSync(txtPath, "utf8").includes("WRITTEN-TREE"));
});

test("flush throttles: a second non-forced flush within 1s is a no-op write", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const txtPath = box.file("FOREST.txt");
  const f = new Forest({ txtPath, dataPath: box.file("forest.jsonl") });
  f.plan(1);
  f.plant(0, ["FIRST"], "oak", 1);

  f.flush(true);                                  // forced: establishes _lastFlush
  writeFileSync(txtPath, "SENTINEL");             // tamper to detect a rewrite
  const ret = f.flush(false);                     // throttled: should skip the write
  assert.equal(ret, txtPath, "still returns the path");
  assert.equal(readFileSync(txtPath, "utf8"), "SENTINEL", "did not rewrite within 1s");
});

test("flush(false) writes when no prior flush has happened", (t) => {
  const box = tmp();
  t.after(box.cleanup);
  const txtPath = box.file("FOREST.txt");
  const f = new Forest({ txtPath, dataPath: box.file("forest.jsonl") });
  f.plan(1);
  f.plant(0, ["FRESH"], "oak", 1);
  f.flush(false);   // _lastFlush is undefined → 0, so the gap exceeds 1s
  assert.ok(existsSync(txtPath), "first unforced flush writes");
  assert.ok(readFileSync(txtPath, "utf8").includes("FRESH"));
});
