// Unit tests for lib/engine/tasks.js — the pure data arrays TASKS, ADJECTIVES, and
// ASH_FACTS. Each must be a non-empty array of non-empty (non-whitespace)
// strings. Lengths are pinned as a regression guard against accidental
// additions/removals.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TASKS, ADJECTIVES, ASH_FACTS } from "../lib/engine/tasks.js";

// Every export is a non-empty array of non-empty, non-whitespace strings.
for (const [name, arr] of [["TASKS", TASKS], ["ADJECTIVES", ADJECTIVES], ["ASH_FACTS", ASH_FACTS]]) {
  test(`${name} is a non-empty array of non-empty strings`, () => {
    assert.ok(Array.isArray(arr), `${name} is an array`);
    assert.ok(arr.length > 0, `${name} is non-empty`);
    for (const [i, entry] of arr.entries()) {
      assert.equal(typeof entry, "string", `${name}[${i}] is a string`);
      assert.ok(entry.trim().length > 0, `${name}[${i}] is not empty/whitespace`);
    }
  });
}

// Pin current lengths so additions/removals are a deliberate, reviewed change.
test("array lengths are pinned (regression guard)", () => {
  assert.equal(TASKS.length, 57);
  assert.equal(ADJECTIVES.length, 15);
  assert.equal(ASH_FACTS.length, 12);
});
