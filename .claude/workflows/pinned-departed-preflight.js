export const meta = {
  name: 'pinned-departed-preflight',
  description: 'Short preflight of 4d8af20: after a booking\'s departure day no edit of its rooms or dates undoes a move or moves its cleaning (_wanted.departed), before db push of 20260927120000',
  phases: [
    { title: 'Lens', detail: 'the rule, by experiment and by reading' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar,
branch pinned-followup. CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree.

UNDER REVIEW: commit 4d8af20 (git show 4d8af20) on top of d908633, in supabase/migrations/20260927120000_pinned_rooms.sql
(not yet in the cloud; the cloud head is 20260926160000). The owner's word of 2026-09-27: once the day a booking leaves
has passed, no edit of the booking — of its rooms or of its dates — undoes a manager's move or moves its cleaning,
moved or not. Implementation: generate_cleaning_tasks's _wanted gets departed = r.departure_date < (now() at time zone
p.timezone)::date (p = the room or listing cleaned); the reschedule pass skips rows with w.departed; the relocate pass,
which still takes a cleaning to the room its guest was in, keeps pinned_* when the target place's booking has departed.
A booking that turns out to leave later (new departure today or ahead) is not departed and is followed. The expired
stopper, the insert, the cancel pass and the refresh of moved cleanings are unchanged. Tests: supabase/tests/
pinned_cleaning.sql section 16 (91 checks), and task_generation.sql where the check "the live row followed the booking
instead" (onto a tried day five days gone) became "stays on its day". The probe docs/rollout/postpush_pinned_rooms.sql
expects generate_cleaning_tasks f056f340/22019.

TOOLS: local stack UP with the branch's bodies applied (LF). psql: docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql
-U postgres -d postgres -v ON_ERROR_STOP=1. ALWAYS begin; ... rollback; — never db:reset, never migration up/down, never
redefine a function outside a rolled-back transaction. CLOUD read-only: node scripts/cloud-read.mjs <file.sql> (catalog
and counts only, no personal data in your report). Never db push, never db query --linked, never git commit/push,
never edit files. MEMORY: at most two agents at once on this machine.

CALIBRATION: report only what you SAW — by experiment, or by quoting the exact lines. An empty findings list is a fine
answer. Severity: critical = data loss / wrong cleaner / security; high = a wrong day, a lost move or a flat left
uncleaned in a realistic case; medium = an edge case or a misleading text; low = style.
`

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          where: { type: 'string' },
          what: { type: 'string' },
          how_seen: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'severity', 'where', 'what', 'how_seen', 'fix'],
      },
    },
    verified: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'verified'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
    better_fix: { type: 'string' },
  },
  required: ['refuted', 'reason', 'severity', 'better_fix'],
}

const LENS = `LENS: THE RULE AFTER THE DEPARTURE DAY. By experiment in rolled-back transactions (build your own bookings,
ids 96000xxxx, rooms via public.property_id_for_unit(96xxx); a manager's move through public.save_task with
p_expected_date, as pg_temp.move in pinned_cleaning.sql does): (1) the boundary — departure today is not departed,
yesterday is; a property in a zone far from UTC (e.g. Pacific/Kiritimati, America/Adak) near midnight; a room whose
timezone differs from its listing's; (2) every edit after the departure day — dates earlier, dates later but still
past, arrival only, rooms swapped/added/given up/all dropped, the booking moved to another listing — for moved and
unmoved cleanings of every unstarted status (unassigned, assigned, accepted): does any of them still pull a cleaning
onto a past day, or lose a cleaner, or leave two live cleanings for one place, or cancel one that should stay; (3) a
booking that turns out to leave later (new departure today or ahead) is followed, its move undone; (4) what departed
rows no longer get: the window/priority/guests/due_at update and accepted → assigned — any realistic harm; (5) the
relocate pass keeping pins on departed bookings: can a kept pin later make the expired stopper or the refresh pass do
something wrong; (6) the change in task_generation.sql — is the new expectation the owner's rule, and does any other
test set now encode the old behaviour silently (run supabase/tests/task_generation.sql, task_expiry.sql,
pinned_cleaning.sql once); (7) diff the generator body against d908633 — only departed and its two uses changed?
(8) optional, read-only cloud: how many unstarted booking cleanings in the cloud belong to bookings that have already
left (counts only) — the rows the new rule stops touching. Time one 97-day run against the d908633 body in pg_temp if
you can.`

const MAX_AGENTS = 2
let running = 0
const waiting = []

async function limited(prompt, opts) {
  while (running >= MAX_AGENTS) {
    await new Promise((resolve) => waiting.push(resolve))
  }
  running += 1
  try {
    return await agent(prompt, opts)
  } finally {
    running -= 1
    const next = waiting.shift()
    if (next) next()
  }
}

phase('Lens')
const report = await limited(`${CONTEXT}\n\n${LENS}`, { label: 'lens:departed', phase: 'Lens', schema: FINDING_SCHEMA })

const findings = report ? report.findings : []
const judged = await parallel(
  findings.map((f) => () =>
    limited(
      `${CONTEXT}\n\nTry to REFUTE this finding by experiment or by reading the exact lines. If it does not reproduce, or no real caller can reach it, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
      { label: `refute:${f.severity}`, phase: 'Refute', schema: VERDICT_SCHEMA },
    ).then((v) => ({ finding: f, verdict: v })),
  ),
)

const done = judged.filter(Boolean)
return {
  verified: report ? report.verified : [],
  confirmed: done.filter((j) => !j.verdict || !j.verdict.refuted),
  dropped: done.filter((j) => j.verdict && j.verdict.refuted),
}
