// Platform spec for LinkedIn (networking, but it's surveillance with a blazer).
// A spec is just: { name, label, warning, buildUrl(shareText, link) }.
// LinkedIn's offsite-share intent only takes a URL, not prefilled text — so the
// orchestrator copies your braggy caption to the clipboard energy of your soul.

/** @type {import("./index.js").PlatformSpec} */
export const linkedin = {
  name: "linkedin",
  label: "LinkedIn",
  warning:
    "LinkedIn turns your bad day into a 7-slide carousel and your résumé into a " +
    "lead list. It only takes the link — paste the rest yourself, agreeable to discuss.",
  textOnly: true, // share-offsite ignores caption text; we print it for pasting
  buildUrl(_shareText, link) {
    return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
  },
};
