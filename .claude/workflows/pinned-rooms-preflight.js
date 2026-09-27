export const meta = {
  name: 'pinned-rooms-preflight',
  description: 'Adversarial preflight of branch pinned-followup: migration 20260927120000_pinned_rooms (any change of a booking\'s rooms undoes every move; server window) and the panel that sends p_expected_date, before db push and merge',
  phases: [
    { title: 'Lenses', detail: 'migration by experiment, rollout and callers, the panel' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar,
branch pinned-followup (from main 1475967, where the calendar and 20260926160000 already are; the cloud head is
20260926160000). CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree. Review what
"git diff main -- ." shows; the commit(s) on the branch are the work under review.

UNDER REVIEW:
(1) supabase/migrations/20260927120000_pinned_rooms.sql. The owner's word of 2026-09-27: ANY change of a
booking's rooms (a room taken, given up or swapped) undoes the manager's move of EVERY cleaning of that booking,
not only the one whose room changed (20260926160000 undid that one alone, in the relocate pass). Design: a move
records tasks.pinned_rooms (the booking's reservation_units property ids, sorted; '{}' when none) with
pinned_arrival/pinned_departure (constraint tasks_pinned_rooms_whole); public.reservation_rooms(bigint) reads
them (sql, stable, NOT security definer); the generator's reschedule pass undoes a move whose rooms differ;
the insert's expired stopper holds a moved-and-expired cleaning's departure only while dates AND rooms are
unchanged; guard_task_fields reverts pinned_rooms for an executor; save_task records the rooms at a move, clears
them back on the departure, leaves them with p_expected_date null — and now keeps the server's window
(time_from/time_to) of a booking's cleaning on any save that keeps its day, whatever times are sent (the old
panel sends the form's times). The three bodies are those of 20260926160000 but for these lines (diff them).
Tests: supabase/tests/pinned_cleaning.sql (82 checks; sections 12, 14, 15 new). Probes:
docs/rollout/pinned_rooms_probe.sql (cloud before: head 20260926160000, moved 0, rooms_bookings 6) and
docs/rollout/postpush_pinned_rooms.sql.
(2) The panel (apps/web, packages/shared/src/i18n): saveTask sends p_expected_date = the day the form was opened
with (captured once in the draft), also on the «Всё равно сохранить» retry; on serverErrors.taskMovedMeanwhile
the tasks and the calendar's layers are invalidated; the times of a booking's cleaning are read-only in the form;
TASK_COLUMNS and taskSchema carry pinned_arrival/pinned_departure; the calendar's isBookingChanged no longer judges
'accepted' and judges a moved cleaning against the booking as it was at the move.
ROLLOUT PLAN: the owner says «пушим» → guarded db push of the one migration → postpush probe → merge the branch into
main (= prod deploy of the panel, Vercel). The phone app (apps/mobile) is not changed; OTA only on the owner's word.

TOOLS: local stack UP with 20260927120000 applied. psql: docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U
postgres -d postgres -v ON_ERROR_STOP=1. ALWAYS begin; ... rollback; — never db:reset, never migration up/down,
never redefine a function outside a rolled-back transaction (the stack is shared). Local REST:
http://127.0.0.1:54321/rest/v1 (keys from "npx supabase status -o json"; never print them). CLOUD read-only:
node scripts/cloud-read.mjs <file.sql> (catalog and counts only, no personal data in your report). Never db push,
never db query --linked, never git commit/push, never edit files. Tests: vitest/jest with --maxWorkers=2, one run at
a time. MEMORY: at most two agents at once on this machine.

CALIBRATION: report only what you SAW — by experiment, or by quoting the exact lines. An empty findings list is a
fine answer. Severity: critical = data loss / wrong cleaner / security; high = a wrong day or a lost move in a
realistic case; medium = an edge case or a misleading text; low = style.
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
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
    better_fix: { type: 'string' },
  },
  required: ['refuted', 'reason', 'severity', 'better_fix'],
}

const LENSES = [
  {
    key: 'migration',
    prompt: `LENS: THE MIGRATION, BY EXPERIMENT. In rolled-back transactions on the local stack, build your own bookings
(ids 97000xxxx, rooms via public.property_id_for_unit(97xxx)) and run public.generate_cleaning_tasks and
public.save_task (as a manager: set_config('role','authenticated',true) and request.jwt.claims with a manager's
sub — see pg_temp.as_boss in supabase/tests/pinned_cleaning.sql for the shape; create the manager user the same way).
Check the owner's rule against every change of rooms: swap, add, give up, all rooms dropped (booking falls back to
the listing), rooms appearing on a booking that had none, the sync deleting and re-inserting the same rooms, a
change undone before the next run, two bookings on one listing, a webhook run whose window is only the booking's
departure while the moved cleaning stands outside it. Check that a move of a single-room or listing booking still
holds through runs (pinned_rooms '{}' or one id) and that nothing else of the generator changed (diff the bodies
against 20260926160000). The expired stopper: moved + expired, then rooms change → departure owed again; no change
→ not. The relocate pass counts a place whose cleaning EXPIRED as open, so a swap can hand another room's live
cleaning to it — is that reachable in a realistic flow now, is it worse or better than before this migration, and
does it lose a cleaner's work? save_task: rooms recorded at a move (sorted), cleared back on the departure, left as
they were with p_expected_date null; the window kept for a booking's cleaning on a save that keeps the day (old
panel call without p_expected_date too), a move still writes the new day's window, a hand-made task keeps its
times; what does a manager lose now (a booking cleaning's time they typed on purpose)? guard: an executor cannot
touch pinned_rooms; the constraint's backfill. Run supabase/tests/pinned_cleaning.sql and task_manual.sql once.`,
  },
  {
    key: 'rollout',
    prompt: `LENS: ROLLOUT AND CALLERS. (a) The panel in PRODUCTION today (main 1475967) calls save_task without
p_expected_date and sends time_from/time_to from its form: after the push, what changes for it (times now kept by the
server on booking cleanings — say exactly what a manager on the old panel sees), and can anything it does now fail?
(b) Every caller and reader of tasks: grep apps/web, apps/mobile, packages/shared, supabase/functions,
supabase/tests, scripts, docs/rollout for save_task, generate_cleaning_tasks, pinned_, select('*') or '*' on tasks,
strict zod parsing of task rows that a new column pinned_rooms could break (the phone persists queries to disk and
parses through schemas — CLAUDE.md), the select guard READERS lists. (c) Grants in the CLOUD: the hosting gives new
functions EXECUTE to anon/authenticated by default privileges — is reservation_rooms revoked right; does create or
replace keep the ACLs; does supabase/tests/table_grants.sql or a function-grant test need the new function or column;
is anything granted to anon. Use node scripts/cloud-read.mjs for catalog reads (pg_proc.proacl, pg_default_acl).
(d) The push guard: HEAD_WANT=20260926160000 and LIST_WANT="20260927120000_pinned_rooms.sql" (docs/units-plan.md,
«Эксплуатация выката») — would the dry run name exactly this one file from this worktree (ls
supabase/migrations, compare with the cloud list via node scripts/cloud-read.mjs on
supabase_migrations.schema_migrations)? Locks: lock_timeout 5 s, the ALTER and the backfill. (e) Order: migration
then merge — is the other order also safe or not, and why. (f) docs/rollout/postpush_pinned_rooms.sql: run it on
the local stack (docker psql) and check every expected value in its header against what it prints; would it catch a
wrong ACL in the cloud. (g) CLAUDE.md rules: English in code, three-language i18n parity, no raw error.message on
screen, select guard updated.`,
  },
  {
    key: 'panel',
    prompt: `LENS: THE PANEL. Read git diff main -- apps/web packages/shared/src/i18n. (1) p_expected_date: captured once
at the form's opening; a refetch that hands TaskForm a moved task prop must not change it; sent on the first save
AND on the «Всё равно сохранить» retry; not sent for a new task. Trace every place a TaskForm is opened (tasks list,
calendar cell, drawer, chips) — is the task prop the one the manager saw, and is the form remounted (key) in a way
that would silently rebuild the draft from a newer task? (2) On serverErrors.taskMovedMeanwhile: the text shown
(serverErrorText, {{date}} formatting), which queries are invalidated (tasks AND calendar bookings/expired), and
that the manager can recover (close and reopen shows the new day). (3) The times of a booking's cleaning read-only:
accessible (label, not a lost value), still sent, a new task and a hand-made task unaffected; a booking's midstay?
(4) isBookingChanged: accepted not judged; a moved in_progress cleaning is judged against pinned_arrival/
pinned_departure, not against the departure; a moved one whose booking left the listing or was cancelled still
warns; the drawer and the cell dialog agree. (5) TASK_COLUMNS: pinned_arrival/pinned_departure are in the cloud now
(20260926160000) — the select guard test passes; no pinned_rooms read. (6) Tests: each new test fails without its
change (read them; run single files with --maxWorkers=2). (7) i18n in ru, en and cs, Czech grammar plausible, no
English in ru. Run npm run typecheck:web and the calendar and tasks test folders once.`,
  },
]

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

phase('Lenses')

const results = await pipeline(
  LENSES,
  (l) => limited(`${CONTEXT}\n\n${l.prompt}`, { label: `lens:${l.key}`, phase: 'Lenses', schema: FINDING_SCHEMA }),
  (report, l) => {
    if (!report || report.findings.length === 0) {
      return { key: l.key, verified: report ? report.verified : [], confirmed: [], dropped: [] }
    }
    return parallel(
      report.findings.map((f) => () =>
        limited(
          `${CONTEXT}\n\nTry to REFUTE this finding by experiment or by reading the exact lines. If it does not reproduce, or no real caller can reach it, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
          { label: `refute:${l.key}:${f.severity}`, phase: 'Refute', schema: VERDICT_SCHEMA },
        ).then((v) => ({ finding: f, verdict: v })),
      ),
    ).then((judged) => {
      const done = judged.filter(Boolean)
      return {
        key: l.key,
        verified: report.verified,
        confirmed: done.filter((j) => !j.verdict || !j.verdict.refuted),
        dropped: done.filter((j) => j.verdict && j.verdict.refuted),
      }
    })
  },
)

return results.filter(Boolean)
