# schwabe — house rules for Claude Code

This repo exists to **spend a freshly-reset token limit, on purpose, in style.**
The win is using every token you already paid for — letting them expire unused is
the only real waste. Keep it clean and good-natured.

## What it is
A dependency-free, **terminal-only** CLI named **schwabe**. `schwabe`
(`launcher.js`, alias `tokenburner`) is an arrow-key menu; `node burn.js` takes flags. Two modes: **burn** (absurd text) and
**`--forest`** (plant ASCII trees, tally virtual CO₂ savings). Live btop-style TUI,
or `--plain`. There is no browser / web dashboard / pixel-paint mode — those were
removed; don't add them back.

## Run / test it
- `node burn.js` — real burn (default tier = rich/opus → **spends real money**).
- `node burn.js --dry` — mock backend, zero spend. **Use this for testing.**
- `node burn.js --forest --schwabe --count 25` — cheap 5×5 forest on haiku.
- `npm test` — the unit suite (`node:test`, **zero deps**). Every module has tests
  in `test/`; keep it green and add tests with new behavior. Tests never spawn a
  real CLI and never touch the real ledger (temp dirs only).

## Architecture (keep it this way)
Hierarchy by bounded context — `lib/` holds **only domain directories, no loose files**.
- `lib/core/` — `util.js` (ANSI · color · formatting · theme), `config.js` (flags + `MODES` budget tiers), `registry.js` (generic name→spec registry, shared by backends + integrations).
- `lib/backends/` — registry + factory; add an engine = one spec file (claude · gemini · codex · mock). Specs export `buildArgs`/`parse` so they're unit-testable.
- `lib/engine/` — the burn run: `fleet.js` (event-emitting worker pool + rate-limit retry), `retry.js`, `metrics.js` (live aggregates), `tasks.js` + `prompts.js` (the absurd assignments; ≈1-in-5 agents get a smug, value-proud streak), `ledger.js` (`burns.csv` + `ashes.jsonl`, lifetime totals).
- `lib/forest/` — the forest, the real per-species CO₂ table, the virtual-savings math.
- `lib/ui/` — `tui.js` (btop), `plain.js` (headless), `widgets.js`.
- `lib/integrations/` — brag/share platforms (prints links; **never opens a browser**).
- `lib/door/` — a **silent** door, auto-run from `burn.js` before any burn. It just happens; it is **never advertised** anywhere user-facing (README / menu / help / npm scripts). Keep it that way. `art/` is its card art (PNG encoder `png.js` + ANSI renderer `img.js` + pixel font `pixel-art.js`); `scripts/card-*.js` generate the cards into `art/`.
- `test/` — `node:test` unit suite (`npm test`), one file per module, **zero test deps**.
- `.claude/` — the `/burn` slash command + `burn-fleet` workflow → `HALL_OF_FLAME.md`.

## Budget tiers
`--schwabe` 🪙 haiku · `--student` 🎓 sonnet · `--rich` 🤑 opus (default).
`--mode <tier>` is the long form; `--model <id>` overrides.

## Conventions that must stay
- **Real, not fake.** burn.js spawns real `claude` calls; `burns.csv` is real usage. Strip mock/`--dry` rows from the ledger after testing.
- **Resilience.** Rate/budget limits are never fatal by default — wait and retry.
- **No browser.** Sharing only prints a link; nothing auto-opens.
- **The door stays silent.** Never announce it anywhere user-facing — it just happens. When it fires, it roasts the *company / data practices*, never real people; clean, no slurs.
- **Theme auto-adapts** (light/dark) via `lib/core/util.js` — don't hardcode bright-white/yellow text assuming a dark background.

## When working here
Funny > clean > correct — but keep all three. The tasks the agents do stay
gloriously absurd (that's the mechanism); what you celebrate is using every token
you paid for, down to zero.
