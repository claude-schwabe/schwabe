// Resilience: when the tank runs dry (rate limit / budget / overage / overload),
// don't die — wait and keep trying until it works again, then resume burning.
// This module decides whether a failed burn is worth retrying and for how long.

const RETRYABLE = [
  /rate.?limit/i, /usage limit/i, /overage/i, /\b429\b/, /\b529\b/,
  /quota/i, /resets? at/i, /try again/i, /temporarily/i, /capacity/i,
  /overloaded/i, /exhaust/i, /too many requests/i, /please wait/i,
  /insufficient/i, /budget/i, /limit reached/i,
];

// Inspect a failed Result. Returns { retryable, resetAt?, reason }.
export function classify(result) {
  if (result.ok) return { retryable: false };
  const text = `${result.error || ""} ${result.raw || ""}`;
  const retryable = !!result.resetAt || RETRYABLE.some((re) => re.test(text));
  return { retryable, resetAt: result.resetAt, reason: retryable ? "rate / budget limit" : "error" };
}

// Jittered exponential backoff, capped.
export function backoffMs(attempt, base, cap) {
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

// How long to wait before the next attempt. If the provider told us when the
// limit resets, wait toward that (but never longer than the cap, so we re-probe
// regularly in case it clears early). Otherwise, plain backoff.
export function nextWaitMs(attempt, cls, cfg) {
  if (cls.resetAt) {
    const until = cls.resetAt * 1000 - Date.now();
    if (until > 0) return Math.min(until, cfg.retryCapMs);
  }
  return backoffMs(attempt, cfg.retryBaseMs, cfg.retryCapMs);
}
