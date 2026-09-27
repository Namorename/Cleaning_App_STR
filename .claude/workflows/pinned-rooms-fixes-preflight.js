export const meta = {
  name: 'pinned-rooms-fixes-preflight',
  description: 'Short preflight of f485295, the fixes to the findings of pinned-rooms-preflight (relocate order, rollback text, probe hashes, calendar months read, dates in refusals), before db push',
  phases: [
    { title: 'Lens', detail: 'the fixes, by experiment and by reading' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar,
branch pinned-followup. CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree.

UNDER REVIEW: commit f485295 (git show f485295), on top of acf8c99 (migration 20260927120000_pinned_rooms and the
panel that sends p_expected_date), which the preflight wf_64fca96a-430 already reviewed. The fixes:
(1) the relocate pass of generate_cleaning_tasks ranks open places that hold only an expired cleaning of the booking
after rooms it has just taken (open_place's row_number order: exists(expired row), property_id); test section 14,
booking 46, in supabase/tests/pinned_cleaning.sql (86 checks);
(2) the ROLLBACK paragraph of the migration's header rewritten (old bodies cannot come back while
tasks_pinned_rooms_whole exists);
(3) docs/rollout/postpush_pinned_rooms.sql: md5/length of the bodies measured from the committed migration file (LF),
plus a has_cr flag per function;
(4) the calendar's «бронь изменилась» (apps/web/src/features/calendar/chips.ts isBookingChanged) now takes
BookingsRead {byId, from, to} — the months the bookings layer read, built in calendar-view.tsx — and does not judge a
moved cleaning whose booking is missing when its stay at the move lies outside those months; the prop type changed in
calendar-grid, row-track, task-chips, task-dialogs, cell-tasks-dialog;
(5) apps/web/src/lib/server-error.ts serverErrorText formats a YYYY-MM-DD parameter with formatDay in the panel's
language (taskMovedMeanwhile, taskDuplicate, and any other key that carries such a value).
Left open on purpose, NOT a finding: a change of rooms after the booking's departure pulls a forward-moved sibling back
onto the past departure (the owner decides).

TOOLS: local stack UP with 20260927120000 applied (bodies re-applied from the file, LF). psql: docker exec -i
supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -v ON_ERROR_STOP=1. ALWAYS begin; ... rollback; —
never db:reset, never migration up/down, never redefine a function outside a rolled-back transaction. CLOUD
read-only: node scripts/cloud-read.mjs <file.sql> (catalog and counts only). Never db push, never db query --linked,
never git commit/push, never edit files. vitest with --maxWorkers=2, one run at a time. MEMORY: at most two agents at
once on this machine.

CALIBRATION: report only what you SAW — by experiment, or by quoting the exact lines. An empty findings list is a
fine answer.
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

const LENS = `LENS: THE FIXES. (1) Relocate order, by experiment in rolled-back transactions: the swap next to an expired
room now follows the guest; the cases the relocate pass already handled keep their answers (listing to rooms, rooms
to listing, two rooms swapped at once — pairing in room order, a room given up while another is taken, a cancelled
cleaning's place); can the new order send a live cleaning to a place the insert would NOT owe (e.g. an expired row
that still stops the insert) where before it went to an owed place; does anything lose a cleaner's work. Diff the
generator body against acf8c99 (git show acf8c99:supabase/migrations/20260927120000_pinned_rooms.sql) — only the
open_place order changed? Time one 97-day run on data you build if you can, against the acf8c99 body in pg_temp.
(2) The ROLLBACK text: is every statement true (try the old save_task and old generator bodies of 20260926160000 in a
rolled-back transaction with the constraint present, and with it dropped and pinned_rooms nulled). (3) The probe: hash
each body of the committed migration file yourself (the text between the dollar quotes, as prosrc holds it) and
compare with the header of docs/rollout/postpush_pinned_rooms.sql and with the local stack; run the probe on the local
stack; does has_cr read right. (4) BookingsRead: every caller and every place a map of bookings used to flow (grep
ReadonlyMap<number, CalendarBooking>, bookings=, .get( on bookings); the stand (CALENDAR_FIXTURE) path; from/to for a
window spanning two or three months and for one month; a moved cleaning inside and outside the read months; unmoved
cleanings unchanged. (5) Dates in refusals: every serverErrors key in packages/shared/src/i18n/locales/ru.json whose
parameters could be a YYYY-MM-DD string (grep the migrations for detail = jsonb_build_object(... 'date' or other
date-valued keys) — is formatting right for each, and is there any parameter that looks like a day but must stay
raw; the phone (apps/mobile) unchanged. Run pinned_cleaning.sql once, npm run typecheck:web, and the calendar, tasks
and lib test folders once.`

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
const report = await limited(`${CONTEXT}\n\n${LENS}`, { label: 'lens:fixes', phase: 'Lens', schema: FINDING_SCHEMA })

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
