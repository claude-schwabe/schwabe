// OpenAI Codex CLI backend. Not installed on every machine — the registry skips
// it automatically when `codex` isn't on PATH. `codex exec` runs non-interactive.
// buildArgs/parse are exported standalone so they can be unit-tested directly.

import { makeBackend, estimateTokens } from "./base.js";

export function codexBuildArgs(prompt) {
  return ["exec", prompt];
}

export function codexParse(stdout) {
  const text = stdout.trim();
  return {
    text,
    costUsd: 0,
    usage: { outputTokens: estimateTokens(text) },
    estimated: true,
  };
}

export const codex = makeBackend({
  name: "codex",
  label: "Codex CLI",
  cmd: "codex",
  buildArgs: codexBuildArgs,
  parse: codexParse,
});
