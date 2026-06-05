// Unit tests for lib/core/registry.js — the generic name→spec registry shared by the
// backend and platform registries.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../lib/core/registry.js";

const items = { alpha: { name: "alpha" }, beta: { name: "beta" } };

test("resolve returns the spec by exact name", () => {
  const r = createRegistry("thing", items);
  assert.equal(r.resolve("alpha").name, "alpha");
  assert.equal(r.resolve("beta").name, "beta");
});

test("resolve is case-insensitive", () => {
  const r = createRegistry("thing", items);
  assert.equal(r.resolve("ALPHA").name, "alpha");
  assert.equal(r.resolve("Beta").name, "beta");
});

test("resolve throws a helpful error listing valid names", () => {
  const r = createRegistry("backend", items);
  assert.throws(() => r.resolve("zeta"), /unknown backend "zeta"\. try one of: alpha, beta/);
  assert.throws(() => r.resolve(""), /unknown backend/);
  assert.throws(() => r.resolve(), /unknown backend/);
});

test("list returns the registered names in order", () => {
  const r = createRegistry("thing", items);
  assert.deepEqual(r.list(), ["alpha", "beta"]);
});

test("map is a copy that does not leak into the source items", () => {
  const src = { a: { name: "a" } };
  const r = createRegistry("thing", src);
  r.map.b = { name: "b" };
  assert.deepEqual(Object.keys(src), ["a"], "source object untouched");
  assert.deepEqual(r.list(), ["a", "b"]);
});
