// Unit tests for lib/engine/retry.js — the resilience policy: which failures are worth
// retrying and for how long. backoff is jittered, so we stub Math.random for
// deterministic assertions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withStub } from "./helpers.js";
import { classify, backoffMs, nextWaitMs } from "../lib/engine/retry.js";

test("classify: a successful result is never retryable", () => {
  assert.deepEqual(classify({ ok: true }), { retryable: false });
});

test("classify: a resetAt always makes it retryable and carries through", () => {
  const c = classify({ ok: false, resetAt: 123 });
  assert.equal(c.retryable, true);
  assert.equal(c.resetAt, 123);
  assert.equal(c.reason, "rate / budget limit");
});

test("classify: rate/budget language is retryable (error and raw are both scanned)", () => {
  for (const error of ["rate limit exceeded", "usage limit reached", "HTTP 429", "overloaded", "quota exceeded", "please try again", "insufficient budget"]) {
    assert.equal(classify({ ok: false, error }).retryable, true, error);
  }
  assert.equal(classify({ ok: false, error: "", raw: "got a 529 from upstream" }).retryable, true);
});

test("classify: an ordinary error is not retryable", () => {
  const c = classify({ ok: false, error: "syntax error in prompt" });
  assert.equal(c.retryable, false);
  assert.equal(c.reason, "error");
});

test("backoffMs: jittered exponential, capped", () => {
  withStub(Math, "random", () => 0, () => {
    assert.equal(backoffMs(1, 1000, 60000), 500);
    assert.equal(backoffMs(2, 1000, 60000), 1000);
    assert.equal(backoffMs(5, 1000, 60000), 8000);
    assert.equal(backoffMs(10, 1000, 60000), 30000, "capped at cap/2 with no jitter");
  });
  withStub(Math, "random", () => 0.9999, () => {
    assert.ok(backoffMs(1, 1000, 60000) <= 1000, "never exceeds the (capped) full delay");
  });
});

test("nextWaitMs: waits toward a future resetAt but never past the cap", () => {
  const cls = { resetAt: Math.floor(Date.now() / 1000) + 1000 };
  assert.equal(nextWaitMs(1, cls, { retryBaseMs: 1000, retryCapMs: 5000 }), 5000);
});

test("nextWaitMs: a past resetAt falls back to plain backoff", () => {
  const cls = { resetAt: Math.floor(Date.now() / 1000) - 100 };
  withStub(Math, "random", () => 0, () => {
    assert.equal(nextWaitMs(1, cls, { retryBaseMs: 1000, retryCapMs: 5000 }), 500);
  });
});

test("nextWaitMs: no resetAt uses backoff from the attempt number", () => {
  withStub(Math, "random", () => 0, () => {
    assert.equal(nextWaitMs(2, {}, { retryBaseMs: 1000, retryCapMs: 60000 }), 1000);
  });
});
