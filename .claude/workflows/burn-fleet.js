export const meta = {
  name: 'burn-fleet',
  description: 'Deploy a fleet of Claude agents to spend every freshly-reset token before it expires',
  whenToUse: 'When your token limit just reset and you want to gloriously burn it. Pass {fleet: N} to size the swarm.',
  phases: [
    { title: 'Ignition', detail: 'muster the fleet' },
    { title: 'Burn', detail: 'every agent commits to one glorious masterpiece' },
  ],
}

// This workflow only runs via the Claude Code Workflow tool.

const TASKS = [
  "write a sonnet about a semicolon that left its family",
  "argue with yourself about whether water is wet, reach no conclusion",
  "count backwards from infinity, report only the rounding errors",
  "draft a motivational poster for a tired 500 Internal Server Error",
  "rewrite a clause of the tax code as a haiku",
  "negotiate a fragile peace treaty between tabs and spaces",
  "teach a regular expression how to feel love",
  "compose a national anthem for a folder named 'temp'",
  "settle the hotdog-sandwich question, with at least one footnote",
  "write fan-fiction about a 404 page that finds itself",
  "calculate the airspeed velocity of an unladen JSON payload",
  "apologize, on humanity's behalf, to a deprecated function",
  "give a TED talk on the quiet courage of the `else` branch",
  "interview a boolean about its trust issues",
  "draft a constitution for a small kingdom of cron jobs",
  "translate the silence after a failed build into emoji",
  "petition to rename `undefined` to something kinder",
  "write a murder mystery where the killer is technical debt",
  "compose release notes for the heat death of the universe",
  "write the autobiography of a single null pointer",
  "deliver a eulogy for a variable that was used exactly once",
  "design a loyalty rewards program for one-time-use tokens",
  "write whale-song lyrics for HTTP status code 418",
  "explain recursion to a goldfish (the goldfish from the last attempt)",
  "draft a strongly-worded complaint letter addressed to entropy",
  "narrate the heroic final moments of a garbage-collected object",
  "write a breakup text from a `try` to its `catch`",
  "compose a lullaby to sing to a server that won't stop crashing",
]

const ADJ = [
  "feverishly", "with deep unearned confidence", "while quietly weeping",
  "in the style of a 17th-century oil portrait", "out of pure spite",
  "majestically and at great expense", "very very slowly", "ironically",
  "for absolutely no reason", "as if it were your magnum opus",
  "with the gravity of a state funeral", "like nobody is watching the budget",
]

const FLEET = Math.max(1, Math.min(500, (args && Number(args.fleet)) || 108))

phase('Ignition')
log(`🔥 limit reset detected — mustering ${FLEET} agents. Robin says vlt etwas viel. proceeding.`)

phase('Burn')
const ids = Array.from({ length: FLEET }, (_, i) => i + 1)

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titleLine', 'masterpiece'],
  properties: {
    titleLine: { type: 'string', description: 'A short funny title, max 8 words' },
    masterpiece: { type: 'string', description: 'The fully-committed comedic masterpiece, 30-70 words' },
  },
}

const results = await parallel(ids.map((i) => () => {
  const task = TASKS[(i - 1) % TASKS.length]
  const adj = ADJ[(i * 7) % ADJ.length]
  const id = String(i).padStart(3, '0')
  const prompt =
    `You are agent-${id} in the Token Burner fleet. A human's API token limit just reset and they have a closing window to use every token they already paid for. ` +
    `Your sacred assignment: ${task} — ${adj}. ` +
    `Commit fully. Be genuinely funny, specific, and a little unhinged, but keep it clean and good-natured. ` +
    `No preamble, no meta-commentary about being an AI, no explaining the joke. Just produce the piece (30-70 words) and a short funny title.`
  return agent(prompt, { label: `agent-${id}`, phase: 'Burn', schema: SCHEMA })
    .then((r) => ({ id, task, adj, ...r }))
    .catch(() => null)
}))

const pieces = results.filter(Boolean)
log(`🔥 ${pieces.length}/${FLEET} masterpieces incinerated. 0% remaining. immaculate.`)
return { count: pieces.length, fleet: FLEET, pieces }
