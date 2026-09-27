export const meta = {
  name: 'pinned-simple-rule-preflight',
  description: 'Short preflight of 2e09036: the owner\'s simple rule back (no rule of its own after the departure), and the relocate pass pairing a cleaner\'s cleaning first, before db push of 20260927120000',
  phases: [
    { title: 'Lens', detail: 'the change, by experiment and by reading' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar,
branch pinned-followup. CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree.

UNDER REVIEW: commit 2e09036 (git show 2e09036), in supabase/migrations/20260927120000_pinned_rooms.sql (not yet in the
cloud; the cloud head is 20260926160000). The owner's rule of 2026-09-27, final: the cleaning always follows its booking
— dates (moved, lengthened, left early) and the rooms of a multi-unit listing, the same cleaner; a departure corrected
after the fact takes the cleaning to the new day even if that is yesterday (yesterday's is still seen and doable today,
the sweep closes it a day later — accepted by the owner); a manager's move holds while the booking does not change, and
any change — dates or rooms — undoes the move of EVERY cleaning of the booking; in_progress and paused are never moved or
cancelled; a cancelled booking, a block or a "#" booking cancels the cleaning nobody has started; a booking moved to
another listing: the old cleaning is cancelled, the cleaner is not carried over. NOT findings: any of these.
The commit (a) reverts 4d8af20 (a rule of its own after the departure day — _wanted.departed — withdrawn by the owner) and
restores task_generation.sql's "the live row followed the booking instead"; (b) changes the relocate pass's stray ranking
to (t.assignee_id is null), t.property_id, t.id, so that when a booking keeps fewer places than it has cleanings (rooms
folded into the listing, two rooms made one) the cleaning somebody holds is paired and the one nobody holds is cancelled;
(c) adds pinned_cleaning.sql section 16 (92 checks). The probe docs/rollout/postpush_pinned_rooms.sql expects
generate_cleaning_tasks 216ec74e/21514.

TOOLS: local stack UP with the branch's bodies applied (LF). psql: docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql
-U postgres -d postgres -v ON_ERROR_STOP=1. ALWAYS begin; ... rollback; — never db:reset, never migration up/down, never
redefine a function outside a rolled-back transaction. CLOUD read-only: node scripts/cloud-read.mjs <file.sql> (catalog
and counts only). Never db push, never db query --linked, never git commit/push, never edit files. MEMORY: at most two
agents at once on this machine.

CALIBRATION: report only what you SAW — by experiment, or by quoting the exact lines. An empty findings list is a fine
answer. Severity: critical = data loss / wrong cleaner / security; high = a wrong day, a lost move or a flat left
uncleaned in a realistic case, against the owner's rule above; medium = an edge case or a misleading text; low = style.
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

const LENS = `LENS: THE CHANGE. (1) The revert is whole: diff the generator body against d908633
(git show d908633:supabase/migrations/20260927120000_pinned_rooms.sql) — the only code difference should be the stray
ranking; no trace of departed anywhere (grep the migration, tests, probe, docs/f10-plan.md for a claim that the rule
still exists). (2) The stray ranking, by experiment in rolled-back transactions (ids 95000xxxx, rooms via
public.property_id_for_unit(95xxx)): two cleanings and one place (rooms folded into the listing; {A,B} to {C}) with the
cleaner on the lower room, on the higher room, on both (then property order), none; assigned vs accepted; a moved one;
as many places as cleanings (swaps) — does anything that worked before now pair worse, lose a cleaner, cancel a live
cleaning somebody holds while keeping one nobody holds, or leave two live cleanings on one place; the pairing with
open_place's order (a place holding only an expired cleaning after fresh ones). (3) The owner's rule end to end: dates
moved, lengthened, left early (to yesterday: live, same cleaner, not stale; to two days ago: the sweep closes it — the
owner accepted this), rooms changed before and after the stay (every move undone), in_progress/paused untouched,
cancel/block/"#" cancel unstarted incl. accepted, another listing: old cancelled. (4) Run supabase/tests/
pinned_cleaning.sql, task_generation.sql and task_expiry.sql once; hash the generator body of the committed file (text
between the dollar quotes) against the probe header and the local stack. Time one 97-day run against the d908633 body in
pg_temp if you can.`

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
const report = await limited(`${CONTEXT}\n\n${LENS}`, { label: 'lens:simple-rule', phase: 'Lens', schema: FINDING_SCHEMA })

const findings = report ? report.findings : []
const judged = await parallel(
  findings.map((f) => () =>
    limited(
      `${CONTEXT}\n\nTry to REFUTE this finding by experiment or by reading the exact lines. If it does not reproduce, or no real caller can reach it, or it is the owner's rule as stated above, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
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
