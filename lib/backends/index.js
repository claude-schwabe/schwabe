// Backend registry. To add a provider: write lib/backends/<name>.js exporting a
// spec, import it here, add it to the createRegistry() call. Nothing else changes.

import { createRegistry } from "../core/registry.js";
import { claude } from "./claude.js";
import { gemini } from "./gemini.js";
import { codex } from "./codex.js";
import { mock } from "./mock.js";

const registry = createRegistry("backend", { claude, gemini, codex, mock });
export const REGISTRY = registry.map;

export async function resolveBackend(name) {
  const b = registry.resolve(name); // throws "unknown backend …" with the valid list
  if (!(await b.available())) {
    throw new Error(`backend "${name}" is not available — is the \`${b.cmd}\` CLI installed and on PATH?`);
  }
  return b;
}

export async function availableBackends() {
  const out = [];
  for (const b of Object.values(REGISTRY)) if (await b.available()) out.push(b.name);
  return out;
}
