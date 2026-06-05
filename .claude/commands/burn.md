---
description: Deploy a fleet of Claude agents to gloriously incinerate your freshly-reset token limit
argument-hint: "[fleet size, default 108]"
allowed-tools: Workflow, Bash(node:*), Read, Write, Edit
---

🔥 The user's token limit just reset and there is a closing window to burn it
gloriously. Light it up.

**Fleet size:** `$ARGUMENTS` (if empty, use `108`).

Do exactly this:

1. Run the reusable fleet with the Workflow tool:
   `Workflow({ name: "burn-fleet", args: { fleet: <fleet size> } })`
   It runs in the background and reports back when done. Tell the user they can
   watch the tokens drop in real time with `/workflows` — *dude die % gehen
   runter in real time*, that's the feature.

2. When it completes, read the workflow result JSON from the task output file
   and forge it into the trophy wall:
   `node scripts/forge-hall.js <path-to-output.json> --append`
   (drop `--append` if they want a clean wall instead of adding to it).

3. Report the cremation receipt: how many masterpieces, how many tokens the
   subagents burned (from the run's usage), 100% of the quota spent, vibes
   immaculate. Quote two or three of the funniest titles from `HALL_OF_FLAME.md`.

Rules of the house:
- The win is using every token you paid for. The masterpieces stay gloriously
  absurd — that's the mechanism; don't sand them into something earnest.
- Keep it clean and good-natured.
