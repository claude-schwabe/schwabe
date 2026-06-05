#!/usr/bin/env node
// Regenerate both denial keepsakes. Each card lives in its own script
// (card-codex.js, card-gemini.js) sharing lib/door/art/pixel-art.js; importing them runs
// their render side-effect.
import "./card-codex.js";
import "./card-gemini.js";
