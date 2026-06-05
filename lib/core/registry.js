// A tiny generic registry: name → spec, with a friendly resolver and a lister.
// Backs BOTH the backend registry (lib/backends) and the social-platform
// registry (lib/integrations) so the "look it up by name (case-insensitive),
// or list the valid options" pattern lives in exactly one place. Add a new kind
// of plug-in = call createRegistry() with its specs; nothing else to write.

export function createRegistry(kind, items) {
  const map = { ...items };
  const list = () => Object.keys(map);
  const resolve = (name) => {
    const item = map[String(name || "").toLowerCase()];
    if (!item) throw new Error(`unknown ${kind} "${name}". try one of: ${list().join(", ")}`);
    return item;
  };
  return { map, list, resolve };
}
