// Platform spec for Instagram (no web share intent — it wants you in The App).
// A spec is just: { name, label, warning, buildUrl(shareText, link) }.
// `manual: true` tells the orchestrator there's nothing to prefill: copy the
// caption, open the app, post the screenshot like it's 2014.

/** @type {import("./index.js").PlatformSpec} */
export const instagram = {
  name: "instagram",
  label: "Instagram",
  manual: true, // no web share intent — caption must be pasted by a human thumb
  warning:
    "Instagram has no share link because it physically cannot let you leave The App. " +
    "It logs every screen you stop scrolling on and feeds it to the algorithm that " +
    "ate your evening. Bring your caption; bring your dignity (optional).",
  buildUrl(_shareText, _link) {
    return "https://www.instagram.com/";
  },
};
