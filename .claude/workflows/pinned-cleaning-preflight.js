export const meta = {
  name: 'pinned-cleaning-preflight',
  description: 'Adversarial preflight of 20260926160000_pinned_cleaning (pinned cleaning day, cancel of accepted, duplicate question) before db push',
  phases: [
    { title: 'Lenses', detail: 'generator and save_task semantics; clients and rollout' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar
(branch f10-stage7-calendar). CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree.

UNDER REVIEW: commits 622c3d9 + f2b6128 — supabase/migrations/20260926160000_pinned_cleaning.sql, its test
supabase/tests/pinned_cleaning.sql, packages/shared/src/database.types.ts, docs/rollout/pinned_cleaning_probe.sql,
docs/rollout/postpush_pinned_cleaning.sql, docs/ROADMAP.md (F11). The migration:
- adds tasks.pinned_departure date (null) under set local lock_timeout 5s;
- guard_task_fields: an executor cannot change it;
- save_task: moving a booking's cleaning off the booking's departure day pins it (pinned_departure = departure at
  that moment), moving it back onto the departure unpins it, an edit that keeps the day keeps the pin; a cleaning
  (hand-made, or a generated one moved) landing on a listing+day that already has a live booking cleaning raises
  hint serverErrors.taskDuplicate unless p_allow_duplicate — only when created or when its day/property changes;
- generate_cleaning_tasks: reschedule pass now covers unassigned/assigned/accepted, skips pinned rows, unpins a
  pinned row when the booking's departure arrives on its day; an accepted row whose day changes goes back to
  'assigned' (same assignee) — THIS IS A PROPOSAL the owner confirms before the push; cancel pass: old branch
  (unassigned/assigned, unpinned, day in window, pair not in _wanted) OR any unstarted row (unassigned, assigned,
  accepted, pinned or not) whose booking no longer owes this cleaning (status not new/modified, block, "#"
  service booking, property not active, property neither the booking's listing nor one of its rooms), reached by
  its day in the window OR by its booking's departure in the window; both behind a shared "pair not in _wanted".
Owner decisions: a manager may move a booking's cleaning (the generator must not move it back); cancel of a
booking cancels its unstarted cleaning incl. accepted (decision 2026-09-25 that step 1 did not carry);
in_progress and paused untouched.
Callers of the generator: supabase/functions/process-webhook-events (window = departures of the batch) and
sync-reservations (departures -7..+90 days). Callers of save_task: apps/web/src/features/tasks/api.ts
(task-form.tsx retries with allowDuplicate on serverErrors.taskDuplicate).

LIVE: cloud head 20260926140000. Cloud bodies of the three functions equal those of 20260926102000 /
20260910150000 / 20260923130000 (md5 checked). Cloud probe before the push: no live booking cleaning stands off
its departure, no accepted cleaning of a booking that owes none. main does NOT contain this migration.

TOOLS: local stack UP with this migration applied (migration up + psql re-apply of the same file, no reset).
psql: docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -v ON_ERROR_STOP=1
(supabase_admin for set role). ALWAYS begin; ... rollback; — the stack is shared; never db:reset, never
migration up/down. Single test file: docker exec -i ... psql ... < supabase/tests/<file>.sql. CLOUD read-only,
no question: node scripts/cloud-read.mjs <file.sql> (catalog and counts only, no personal data, no guest names
in output). Never db push, never db query --linked. MEMORY: at most two agents at once.

CALIBRATION: report only what you SAW (an experiment's output or exact lines). An empty findings list is a fine
answer. The accepted -> assigned move is a proposal under the owner's decision: report its consequences, not
that it exists.
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

const LENSES = [
  {
    key: 'semantics',
    prompt: `LENS: WHAT THE GENERATOR AND save_task DO, BY EXPERIMENT. In rolled-back transactions with seeded
properties/reservations (copy the setup of supabase/tests/pinned_cleaning.sql and room_cleanings.sql), try to
break the rules: (1) rooms — a booking with reservation_units, a pinned cleaning on a room; the relocate pass
(listing -> room) on a pinned row; the booking changes its room; the listing branch of the insert. Does any path
write a second live cleaning, violate tasks_one_cleaning_per_reservation, or cancel a cleaning its booking still
owes? (2) narrow webhook windows (from = to = one departure) vs the 100-day sync window: the same scenario must
end the same way. (3) pinned and past: a pinned day already past grace, the expire sweep
(expire_stale_tasks), then the booking moves — does the insert's expired-day branch create anything wrong?
(4) save_task: move to a day, move again, edit other fields, move back; a room cleaning; v_departure when the
booking row is gone; the second duplicate check vs a generated cleaning moved onto another booking's departure
day on the same room. (5) guard_task_fields: an executor (claims of a cleaner, as authenticated through RLS)
cannot set or clear the pin via PostgREST-shaped update. (6) Anything in supabase/tests/*.sql that encoded the
old rule (accepted untouched by reschedule/cancel) and still passes only by accident. Run the whole
pinned_cleaning.sql once to confirm it is green.`,
  },
  {
    key: 'clients-rollout',
    prompt: `LENS: CLIENTS AND ROLLOUT. (1) The phone app (apps/mobile): what happens to a maid whose accepted cleaning
the generator moves to another day and sets back to 'assigned', or cancels — read the task list/detail screens,
the accept flow, persisted query cache (read-cached.ts), offline action queue (does a queued "start" on a
cancelled/moved task fail with a translated error or crash?). Does any zod schema in apps/mobile or apps/web
use .strict() on a tasks row so a new column breaks parsing? (2) The panel: task-form.tsx on a generated
cleaning moved onto a day with another booking's cleaning — what text does the duplicate question show, and does
"create another" do the right thing for an EDIT (it retries with allowDuplicate)? Check the i18n text in
packages/shared/src/i18n/locales/*.json for serverErrors.taskDuplicate. (3) The guard: run ONLY the read-only
parts from THIS worktree — node scripts/cloud-read.mjs docs/rollout/remote_head.sql (expect 20260926140000) and
npx supabase db push --linked --skip-vault --dry-run (dry run only!) — the list must be exactly
20260926160000_pinned_cleaning.sql. (4) Locks: does set local lock_timeout apply inside the CLI's migration
transaction; does anything in the file take a second lock on tasks? Cron: must process-webhook-events be
unscheduled (docs/units-plan.md «Эксплуатация выката»)? (5) Run docs/rollout/postpush_pinned_cleaning.sql locally
as supabase_read_only_user in a read-only transaction and check every label against its header (the local ACL
of guard_task_fields differs from the cloud, the header says why). Run docs/rollout/pinned_cleaning_probe.sql
on the cloud once and report the payload.`,
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
    ).then((judged) => ({
      key: l.key,
      verified: report.verified,
      confirmed: judged.filter(Boolean).filter((j) => !j.verdict || !j.verdict.refuted),
      dropped: judged.filter(Boolean).filter((j) => j.verdict && j.verdict.refuted),
    }))
  },
)

const out = results.filter(Boolean)
log(`confirmed ${out.flatMap((r) => r.confirmed).length}, dropped ${out.flatMap((r) => r.dropped).length}`)
return out
