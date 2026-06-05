// Platform spec for Facebook (where your data goes to be monetized forever).
// A spec is just: { name, label, warning, buildUrl(shareText, link) }.

/** @type {import("./index.js").PlatformSpec} */
export const facebook = {
  name: "facebook",
  label: "Facebook",
  warning:
    "Facebook already knows you're posting this — it watched you decide. It will " +
    "shadow your cursor across the open web and resell the heatmap to a mattress company.",
  buildUrl(shareText, link) {
    const u = encodeURIComponent(link);
    const quote = encodeURIComponent(shareText);
    return `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${quote}`;
  },
};
