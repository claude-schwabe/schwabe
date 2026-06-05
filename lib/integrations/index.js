// Platform registry. To add a social network: write lib/integrations/<name>.js
// exporting a spec, import it here, add it to the createRegistry() call.
// (Shares lib/core/registry.js with lib/backends/index.js — same pattern, one impl.)

import { createRegistry } from "../core/registry.js";
import { facebook } from "./facebook.js";
import { linkedin } from "./linkedin.js";
import { instagram } from "./instagram.js";
import { x } from "./x.js";

/**
 * A social-platform spec — the entire contract for adding a share target. Drop
 * one file in lib/integrations/ exporting this shape and register it below.
 * @typedef {Object} PlatformSpec
 * @property {string} name   registry key (lowercased on lookup)
 * @property {string} label  human label for the warning box
 * @property {string} warning  the doom-box copy shown before posting
 * @property {(shareText: string, link: string) => string} buildUrl  prefilled share URL
 * @property {boolean} [manual]    no web share — the caption is pasted by hand
 * @property {boolean} [textOnly]  the share intent takes only the link, not the caption
 */

const registry = createRegistry("platform", { facebook, linkedin, instagram, x });

export const resolvePlatform = registry.resolve;
export const listPlatforms = registry.list;
