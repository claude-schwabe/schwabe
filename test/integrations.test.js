// Unit tests for lib/integrations/* — the brag/share layer. Covers the caption
// builder (buildShareText), the four platform specs and their pure buildUrl()s,
// the registry resolver/lister (index.js), and the shareRun() happy path (no
// stdin, no browser). Console output is captured by stubbing console.log; we
// never flip the terminal or spawn a real opener.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withStub } from "./helpers.js";
import { stripAnsi } from "../lib/core/util.js";
import {
  buildShareText, shareRun, DEFAULT_LINK,
} from "../lib/integrations/share.js";
import { x } from "../lib/integrations/x.js";
import { facebook } from "../lib/integrations/facebook.js";
import { linkedin } from "../lib/integrations/linkedin.js";
import { instagram } from "../lib/integrations/instagram.js";
import { resolvePlatform, listPlatforms } from "../lib/integrations/index.js";

const SPECS = { x, facebook, linkedin, instagram };

// ── buildShareText ─────────────────────────────────────────────────────────
test("buildShareText formats the token count, names the agent count, ends with the brand hashtag", () => {
  const text = buildShareText({ tokens: 1234567, agents: 5 });
  assert.ok(text.includes("1,234,567"), "token count is grouped via nf");
  assert.ok(text.includes("5 AI agents"), "agent count is mentioned");
  assert.ok(text.trimEnd().endsWith("#schwabe"), "caption ends with the brand hashtag");
});

test("buildShareText uses summary.line verbatim when provided", () => {
  const text = buildShareText({ tokens: 100, agents: 2, line: "my own brag here" });
  assert.ok(text.includes("my own brag here"));
});

test("buildShareText cycles a default brag by agent count when no line is given", () => {
  // BRAGS has 5 entries; index is agents % 5, so agents 0 and 5 share a brag.
  const zero = buildShareText({ tokens: 0, agents: 0 });
  const five = buildShareText({ tokens: 0, agents: 5 });
  const one = buildShareText({ tokens: 0, agents: 1 });
  assert.equal(stripAnsi(zero).replace("5", "0"), stripAnsi(five).replace("5", "0"));
  assert.notEqual(zero, one, "different agent counts pick different brags");
});

test("buildShareText defaults tokens and agents to zero on an empty summary", () => {
  const text = buildShareText();
  assert.ok(text.includes("0 tokens"), "tokens default to 0 (formatted)");
  assert.ok(text.includes("0 AI agents"), "agents default to 0");
  assert.ok(text.trimEnd().endsWith("#schwabe"));
});

// ── platform specs: shared contract ──────────────────────────────────────────
for (const [key, spec] of Object.entries(SPECS)) {
  test(`${key} spec exposes name/label/warning/buildUrl`, () => {
    assert.equal(typeof spec.name, "string");
    assert.ok(spec.name.length > 0, "name is non-empty");
    assert.equal(typeof spec.label, "string");
    assert.ok(spec.label.length > 0, "label is non-empty");
    assert.equal(typeof spec.warning, "string");
    assert.ok(spec.warning.trim().length > 0, "warning is a non-empty string");
    assert.equal(typeof spec.buildUrl, "function");
  });

  test(`${key}.buildUrl returns an https url`, () => {
    const url = spec.buildUrl("hello world", "https://example.test/x");
    assert.match(url, /^https:\/\//, "scheme is https");
    assert.doesNotThrow(() => new URL(url), "url is parseable");
  });
}

// ── platform specs: per-platform URL shape ───────────────────────────────────
test("x.buildUrl builds a twitter intent carrying url-encoded text + link", () => {
  const url = x.buildUrl("hi there & friends", "https://l.test/a b");
  assert.ok(url.startsWith("https://twitter.com/intent/tweet?text="));
  const u = new URL(url);
  // text param round-trips through URL decoding to text + newline + link.
  assert.equal(u.searchParams.get("text"), "hi there & friends\nhttps://l.test/a b");
  // raw query is percent-encoded (no literal spaces/ampersands leaked).
  assert.ok(!url.includes(" "), "spaces are encoded");
  assert.ok(url.includes("%0A"), "newline between text and link is encoded");
});

test("facebook.buildUrl is a sharer with separate u (link) and quote (text) params", () => {
  const url = facebook.buildUrl("braggy caption", "https://l.test/page?x=1");
  assert.ok(url.startsWith("https://www.facebook.com/sharer/sharer.php?"));
  const u = new URL(url);
  assert.equal(u.searchParams.get("u"), "https://l.test/page?x=1", "u carries the link");
  assert.equal(u.searchParams.get("quote"), "braggy caption", "quote carries the caption");
});

test("linkedin.buildUrl is share-offsite with only the url, and the spec is textOnly", () => {
  assert.equal(linkedin.textOnly, true, "linkedin only takes the link");
  const url = linkedin.buildUrl("caption gets dropped", "https://l.test/p");
  assert.ok(url.startsWith("https://www.linkedin.com/sharing/share-offsite/?url="));
  const u = new URL(url);
  assert.equal(u.searchParams.get("url"), "https://l.test/p");
  assert.equal(u.searchParams.get("text"), null, "no text param — caption is not prefilled");
  assert.ok(!url.includes("caption"), "caption text is absent from the url");
});

test("instagram is manual and buildUrl returns the bare instagram url (ignores text + link)", () => {
  assert.equal(instagram.manual, true, "no web share — caption pasted by hand");
  const url = instagram.buildUrl("whatever caption", "https://l.test/ignored");
  assert.equal(url, "https://www.instagram.com/");
  assert.ok(!url.includes("ignored"), "link is not embedded");
});

// ── index.js: registry resolver + lister ─────────────────────────────────────
test("listPlatforms returns the four platform names", () => {
  assert.deepEqual(listPlatforms().sort(), ["facebook", "instagram", "linkedin", "x"]);
});

test("resolvePlatform resolves each name case-insensitively to its spec", () => {
  assert.equal(resolvePlatform("x"), x);
  assert.equal(resolvePlatform("X"), x);
  assert.equal(resolvePlatform("Facebook"), facebook);
  assert.equal(resolvePlatform("LINKEDIN"), linkedin);
  assert.equal(resolvePlatform("InStAgRaM"), instagram);
});

test("resolvePlatform throws 'unknown platform' listing all four for a bad name", () => {
  assert.throws(() => resolvePlatform("myspace"), (err) => {
    assert.match(err.message, /^unknown platform "myspace"/);
    for (const name of ["facebook", "linkedin", "instagram", "x"]) {
      assert.ok(err.message.includes(name), `lists ${name}`);
    }
    return true;
  });
});

// ── shareRun: happy path only (assumeYes, no browser, no stdin) ───────────────
test("shareRun(assumeYes) reports shared:true with a twitter url and the caption", async () => {
  const lines = [];
  const ret = await withStub(console, "log", (...a) => lines.push(a.join(" ")), () =>
    shareRun({
      platform: x,
      summary: { tokens: 1000, agents: 5 },
      assumeYes: true,
    })
  );

  assert.equal(ret.shared, true);
  assert.equal(typeof ret.url, "string");
  assert.ok(ret.url.includes("twitter.com"), "url targets twitter");
  assert.equal(typeof ret.text, "string");
  assert.ok(ret.text.includes("1,000"), "caption carries the formatted token count");
  assert.ok(ret.text.trimEnd().endsWith("#schwabe"));

  // The final URL is always printed (stripped of color) somewhere in the output.
  const out = lines.map(stripAnsi).join("\n");
  assert.ok(out.includes(ret.url), "the share url is printed");
  assert.ok(out.includes("not opening a browser"), "a browser is never opened");
});

test("shareRun prints a paste-by-hand caption for a manual platform (instagram)", async () => {
  const lines = [];
  const ret = await withStub(console, "log", (...a) => lines.push(a.join(" ")), () =>
    shareRun({ platform: instagram, summary: { tokens: 500, agents: 2 }, assumeYes: true }));
  assert.equal(ret.shared, true);
  const out = stripAnsi(lines.join("\n"));
  assert.match(out, /copy this caption and post it by hand/);
});

test("shareRun prints a paste-the-caption note for a link-only platform (linkedin)", async () => {
  const lines = [];
  const ret = await withStub(console, "log", (...a) => lines.push(a.join(" ")), () =>
    shareRun({ platform: linkedin, summary: { tokens: 500, agents: 2 }, assumeYes: true }));
  assert.equal(ret.shared, true);
  const out = stripAnsi(lines.join("\n"));
  assert.match(out, /only takes the link — paste this caption yourself/);
});

test("shareRun accepts a platform passed by name string and resolves it", async () => {
  const ret = await withStub(console, "log", () => {}, () =>
    shareRun({ platform: "x", summary: { tokens: 42, agents: 1 }, assumeYes: true })
  );
  assert.equal(ret.shared, true);
  assert.ok(ret.url.includes("twitter.com"));
});

test("DEFAULT_LINK is an https url", () => {
  assert.equal(typeof DEFAULT_LINK, "string");
  assert.match(DEFAULT_LINK, /^https:\/\//);
  assert.doesNotThrow(() => new URL(DEFAULT_LINK));
});
