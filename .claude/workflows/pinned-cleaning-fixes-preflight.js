export const meta = {
  name: 'pinned-cleaning-fixes-preflight',
  description: 'Short preflight of the fixes in f0a3f86 (save_task p_expected_date and new signature, window end on moved cleanings, expired stopper) before db push',
  phases: [
    { title: 'Lens', detail: 'the fixes, by experiment and by reading' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar
(branch f10-stage7-calendar). CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree.

UNDER REVIEW: commit f0a3f86 on top of 03c2476 — supabase/migrations/20260926160000_pinned_cleaning.sql (the owner's
rule of 2026-09-27: a booking's cleaning follows its booking; a manager's move holds until the booking's dates or
room change; in_progress/paused never move; option B: check-in facts true of the cleaning's day). The fixes:
(1) save_task(... p_allow_duplicate, p_expected_date date default null): the old 12-argument function is DROPPED
and the 13-argument one CREATED, then revoke from public, anon / grant to authenticated, service_role; a save
whose p_expected_date differs from the row's current day raises hint serverErrors.taskMovedMeanwhile (detail
{"date"}); null checks nothing. The prod panel on main calls rpc('save_task', {p_id, p_property_id, p_type,
p_scheduled_date, p_title, p_assignee_id, p_time_from, p_time_to, p_notes, p_allow_duplicate}) — named args,
no p_expected_date. (2) time_to of a moved cleaning = cleaning_turnover_on(...).window_to (next guest's check-in,
else the listing's), written by save_task on a move and by the generator's refresh pass on every run.
(3) the insert's expired stopper: an expired row stops a new cleaning on its own day, or on its pinned departure
only while the booking's arrival still equals pinned_arrival. (4) i18n key serverErrors.taskMovedMeanwhile in
packages/shared/src/i18n/locales/{ru,en,cs}.json. Tests: supabase/tests/pinned_cleaning.sql (61 checks).

LIVE: cloud head 20260926140000, nothing of this migration there; cloud probe counts all 0.
TOOLS: local stack UP with this migration applied. psql: docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U
postgres -d postgres -v ON_ERROR_STOP=1. ALWAYS begin; ... rollback; never db:reset, never migration up/down,
never redefine a function outside a rolled-back transaction. Local REST: http://127.0.0.1:54321/rest/v1 (keys
from "npx supabase status -o json"; never print them). CLOUD read-only: node scripts/cloud-read.mjs <file.sql>
(catalog and counts only). Never db push, never db query --linked. MEMORY: at most two agents at once.

CALIBRATION: report only what you SAW. An empty findings list is a fine answer.
`

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
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
  required: ['lens', 'findings', 'verified'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    better_fix: { type: 'string' },
  },
  required: ['refuted', 'reason', 'better_fix'],
}

const LENS = `LENS: THE FIXES. (1) The new save_task through PostgREST on the LOCAL REST with a manager's JWT: the
exact named-argument call the main panel makes (no p_expected_date) must resolve to the one function and behave as
before for a hand-made task and a booking's cleaning; with p_expected_date stale -> the hint; equal -> saves. Is
there any other caller of save_task (grep apps/, packages/, supabase/functions, tests, docs/rollout) that the drop
breaks — positional calls, a signature named in a test (tenant_isolation, table grants), the select guard
(packages/shared/src/testing/postgrest-select.ts READERS)? Does anything cache the old signature (PostgREST schema
cache after drop+create inside one migration transaction — how does Supabase reload it)? (2) time_to: a moved
cleaning whose day has no arrival gets the listing's check-in; an arrival with 00:00 gets the listing's; a
manager's time_to typed into the same save as a move — what happens, and is that consistent with what the
generator does to an unmoved cleaning's time_to? (3) The stopper: expired moved cleaning + arrival-only change ->
a new cleaning on the departure; + no change -> none; unmoved expired row -> as before (task_generation.sql).
(4) The i18n key: parity, {{date}} used, the panel shows it through serverErrorText. Run pinned_cleaning.sql and
task_manual.sql once.`

phase('Lens')
const report = await agent(`${CONTEXT}\n\n${LENS}`, { label: 'lens:fixes', phase: 'Lens', schema: FINDING_SCHEMA })

const findings = report ? report.findings : []
const judged = []
for (let at = 0; at < findings.length; at += 2) {
  const pair = findings.slice(at, at + 2)
  const verdicts = await parallel(
    pair.map((f) => () =>
      agent(
        `${CONTEXT}\n\nTry to REFUTE this finding by experiment or by reading the exact lines. If it does not reproduce, or no real caller can reach it, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
        { label: `refute:${f.severity}`, phase: 'Refute', schema: VERDICT_SCHEMA },
      ).then((v) => ({ finding: f, verdict: v })),
    ),
  )
  judged.push(...verdicts.filter(Boolean))
}

return {
  verified: report ? report.verified : [],
  confirmed: judged.filter((j) => !j.verdict || !j.verdict.refuted),
  dropped: judged.filter((j) => j.verdict && j.verdict.refuted),
}
