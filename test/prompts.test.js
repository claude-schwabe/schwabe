// Unit tests for lib/engine/prompts.js — the fleet's marching orders. Covers both
// exported builders: buildTasks (absurd-labor assignments, with the ~1-in-5
// "smug" streak driven by Math.random) and buildForestTasks (one ASCII tree per
// agent). We stub the global RNG to force the smug streak deterministically ON
// (random < 0.2) and OFF (random >= 0.2), and we cross-check id/label/adj/species
// cycling against lib/engine/tasks.js and lib/forest/index.js so the math is asserted exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withStub } from "./helpers.js";
import { buildTasks, buildForestTasks } from "../lib/engine/prompts.js";
import { TASKS, ADJECTIVES } from "../lib/engine/tasks.js";
import { FOREST_MARKER, speciesFor, TREE_W, TREE_H } from "../lib/forest/index.js";

// The smug sentence lib/engine/prompts.js appends ~1-in-5 of the time; a stable fragment
// to assert presence/absence without pinning the whole string.
const SMUG_FRAGMENT = "smugly, insufferably proud";

// ── buildTasks ─────────────────────────────────────────────────────────────
test("buildTasks returns an array of exactly count entries", () => {
  withStub(Math, "random", () => 0.5, () => {
    assert.equal(buildTasks(0).length, 0);
    assert.equal(buildTasks(1).length, 1);
    assert.equal(buildTasks(5).length, 5);
  });
});

test("buildTasks zero-pads the id to three digits", () => {
  withStub(Math, "random", () => 0.5, () => {
    const tasks = buildTasks(12);
    assert.equal(tasks[0].id, "001");
    assert.equal(tasks[8].id, "009");
    assert.equal(tasks[9].id, "010");
    assert.equal(tasks[11].id, "012");
  });
});

test("buildTasks cycles label through TASKS via (i-1)%TASKS.length", () => {
  withStub(Math, "random", () => 0.5, () => {
    // Ask for one full lap plus a couple to prove it wraps around.
    const n = TASKS.length + 2;
    const tasks = buildTasks(n);
    for (let i = 1; i <= n; i++) {
      assert.equal(tasks[i - 1].label, TASKS[(i - 1) % TASKS.length], `label at agent ${i}`);
    }
    // Explicit wrap: the (TASKS.length+1)-th agent reuses the first task.
    assert.equal(tasks[TASKS.length].label, TASKS[0], "label wraps back to the first task");
  });
});

test("buildTasks cycles adj through ADJECTIVES via (i*7)%ADJECTIVES.length", () => {
  withStub(Math, "random", () => 0.5, () => {
    const n = ADJECTIVES.length + 3;
    const tasks = buildTasks(n);
    for (let i = 1; i <= n; i++) {
      assert.equal(tasks[i - 1].adj, ADJECTIVES[(i * 7) % ADJECTIVES.length], `adj at agent ${i}`);
    }
  });
});

test("buildTasks prompt embeds the agent id, task, and adjective", () => {
  withStub(Math, "random", () => 0.5, () => {
    const task = buildTasks(1)[0];
    assert.equal(typeof task.prompt, "string");
    assert.ok(task.prompt.includes("agent-001"), "prompt names the agent");
    assert.ok(task.prompt.includes(task.label), "prompt embeds the task label");
    assert.ok(task.prompt.includes(task.adj), "prompt embeds the adjective");
  });
});

test("buildTasks prompt carries the system vibe", () => {
  withStub(Math, "random", () => 0.5, () => {
    const task = buildTasks(1)[0];
    assert.ok(task.prompt.includes("Token Burner fleet"), "prompt sets the fleet vibe");
  });
});

test("buildTasks adds the smug streak when random < 0.2", () => {
  withStub(Math, "random", () => 0, () => {
    for (const task of buildTasks(4)) {
      assert.ok(task.prompt.includes(SMUG_FRAGMENT), "smug streak present for every agent");
    }
  });
  // A value just under the threshold still trips it.
  withStub(Math, "random", () => 0.19, () => {
    assert.ok(buildTasks(1)[0].prompt.includes(SMUG_FRAGMENT));
  });
});

test("buildTasks omits the smug streak when random >= 0.2", () => {
  withStub(Math, "random", () => 0.5, () => {
    for (const task of buildTasks(4)) {
      assert.ok(!task.prompt.includes(SMUG_FRAGMENT), "no smug streak for any agent");
    }
  });
  // Exactly at the threshold is NOT smug (strict less-than).
  withStub(Math, "random", () => 0.2, () => {
    assert.ok(!buildTasks(1)[0].prompt.includes(SMUG_FRAGMENT));
  });
});

test("buildTasks entry exposes exactly id, label, adj, prompt", () => {
  withStub(Math, "random", () => 0.5, () => {
    assert.deepEqual(Object.keys(buildTasks(1)[0]).sort(), ["adj", "id", "label", "prompt"]);
  });
});

// ── buildForestTasks ───────────────────────────────────────────────────────
test("buildForestTasks returns an array of exactly count entries", () => {
  assert.equal(buildForestTasks(0).length, 0);
  assert.equal(buildForestTasks(1).length, 1);
  assert.equal(buildForestTasks(7).length, 7);
});

test("buildForestTasks zero-pads the id to three digits", () => {
  const tasks = buildForestTasks(11);
  assert.equal(tasks[0].id, "001");
  assert.equal(tasks[9].id, "010");
  assert.equal(tasks[10].id, "011");
});

test("buildForestTasks sets treeIndex to i-1 and adj to empty", () => {
  const tasks = buildForestTasks(5);
  tasks.forEach((task, idx) => {
    assert.equal(task.treeIndex, idx, "treeIndex is the zero-based slot");
    assert.equal(task.adj, "", "forest tasks carry no adjective");
  });
});

test("buildForestTasks picks species via speciesFor(i-1) and labels accordingly", () => {
  const tasks = buildForestTasks(6);
  tasks.forEach((task, idx) => {
    const species = speciesFor(idx);
    assert.equal(task.species, species, `species at slot ${idx}`);
    assert.equal(task.label, `plant a ${species}`, `label at slot ${idx}`);
  });
});

test("buildForestTasks prompt is a buildTreePrompt: carries the marker and dimensions", () => {
  const task = buildForestTasks(1)[0];
  assert.equal(typeof task.prompt, "string");
  assert.ok(task.prompt.startsWith(FOREST_MARKER), "prompt opens with the FOREST_MARKER");
  assert.ok(task.prompt.includes(task.species), "prompt names the species to draw");
  assert.ok(task.prompt.includes(`${TREE_W}×${TREE_H}`), "prompt states the cell dimensions");
});

test("buildForestTasks entry exposes exactly id, label, adj, treeIndex, species, prompt", () => {
  assert.deepEqual(
    Object.keys(buildForestTasks(1)[0]).sort(),
    ["adj", "id", "label", "prompt", "species", "treeIndex"],
  );
});
