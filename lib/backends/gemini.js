// Gemini CLI backend — a burn engine. The CLI doesn't emit machine-readable
// token usage, so we estimate from the text and flag it. buildArgs/parse are
// exported standalone so they can be unit-tested without spawning the CLI.

import { makeBackend, estimateTokens } from "./base.js";

export function geminiBuildArgs(prompt) {
  return ["-p", prompt];
}

export function geminiParse(stdout) {
  const text = stdout.trim();
  return {
    text,
    costUsd: 0,
    usage: { outputTokens: estimateTokens(text) },
    estimated: true,
  };
}

export const gemini = makeBackend({
  name: "gemini",
  label: "Gemini CLI",
  cmd: "gemini",
  buildArgs: geminiBuildArgs,
  parse: geminiParse,
});
