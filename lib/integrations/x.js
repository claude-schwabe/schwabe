// Platform spec for X (the website formerly known as having a soul).
// A spec is just: { name, label, warning, buildUrl(shareText, link) }.

/** @type {import("./index.js").PlatformSpec} */
export const x = {
  name: "x",
  label: "X (née Twitter)",
  warning:
    "X will read your DMs in its dreams and sell the screenshots. Your posts " +
    "train a model that will one day write your eulogy — badly, and rate-limited.",
  buildUrl(shareText, link) {
    const text = `${shareText}\n${link}`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  },
};
