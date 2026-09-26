export const meta = {
  name: 'pinned-cleaning-preflight',
  description: 'Adversarial preflight of 20260926160000_pinned_cleaning (the cleaning follows its booking; a manager move holds until the booking changes) before db push',
  phases: [
    { title: 'Lenses', detail: 'generator and save_task semantics; clients and rollout' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar
(branch f10-stage7-calendar). CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree.

UNDER REVIEW: commit 03c2476 — supabase/migrations/20260926160000_pinned_cleaning.sql (rewritten before any
rollout), supabase/tests/pinned_cleaning.sql (54 checks), supabase/tests/task_manual.sql (comment),
packages/shared/src/database.types.ts, docs/rollout/pinned_cleaning_probe.sql, docs/rollout/postpush_pinned_cleaning.sql,
docs/ROADMAP.md (F11). Earlier commits 622c3d9 f2b6128 4019fe7 carried a first version (a pin the generator never
undid); the owner replaced that rule on 2026-09-27. THE OWNER'S RULE NOW:
- the cleaning always follows its booking: moved, lengthened/shortened, or moved to another ROOM of a multi-unit
  listing (common, not rare) -> new departure day, new room, SAME cleaner (same row);
- a manager may put the cleaning on another day; it stays while the booking does not change; ANY change of the
  booking's dates (arrival or departure) or room undoes the manual move and the cleaning follows again;
- in_progress and paused are never moved;
- cancelled booking, block, "#" service booking -> cancel if not started (unassigned, assigned, accepted);
- option B: what the phone shows about the next check-in (priority, due_at, guests_count) is true of the day the
  cleaning stands on;
- F11 pushes (cancelled, moved, moved by manager) are later.
IMPLEMENTATION: tasks.pinned_arrival + pinned_departure (+ CHECK both-or-neither) set by save_task on a move off
the departure; generator: _wanted also takes bookings with an unstarted cleaning on a day of the window (union);
generalized relocate pass (stray rows on the booking's listing/rooms paired by property order with owed places
without a live cleaning; unpins); reschedule follows the booking for unpinned rows and for pinned rows whose
booking dates differ from the snapshot (unpins), accepted->assigned on a day change (dormant: nothing writes
'accepted'); a refresh pass rewrites priority/due_at/guests_count of every live pinned unstarted row via
cleaning_turnover_on (new security definer sql function, a copy of reservation_cleaning_window's next-guest
lateral asked of any day; a test holds the two copies to one answer); cancel = unstarted row reached by its day in
the window or by its booking's departure in it, whose (reservation, property) pair is not in _wanted; insert's
expired stopper also matches pinned_departure. save_task: both duplicate questions only when a task lands on a
day (create / day / property / type change); a move recomputes check-in facts for the new day. A booking moved to
ANOTHER listing is not followed across (old cancelled, new created there) — a stated choice.
Callers of the generator: supabase/functions/process-webhook-events (window = departures of the batch) and
sync-reservations (departures -7..+90). save_task: apps/web/src/features/tasks/api.ts (sends no p_priority).

LIVE: cloud head 20260926140000; the three replaced bodies in the cloud equal those of 20260926102000 /
20260910150000 / 20260923130000; reservation_cleaning_window is untouched (3420c63a). Cloud probe before the
push: no existing cleaning would be changed by the first run (all counts 0). main does NOT contain this migration.

TOOLS: local stack UP with this migration applied (psql re-apply, no reset). psql: docker exec -i
supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -v ON_ERROR_STOP=1 (supabase_admin for set role).
ALWAYS begin; ... rollback; — the stack is shared; never db:reset, never migration up/down, never redefine a
function outside a rolled-back transaction. Single test file: docker exec -i ... psql ... < supabase/tests/<file>.sql.
CLOUD read-only, no question: node scripts/cloud-read.mjs <file.sql> (catalog and counts only, no personal data,
no guest names in output). Never db push, never db query --linked. MEMORY: at most two agents at once.

CALIBRATION: report only what you SAW (an experiment's output or exact lines). An empty findings list is a fine
answer. Report consequences of the owner's rule as notes, not as defects of the rule itself.
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
    prompt: `LENS: DOES THE GENERATOR AND save_task KEEP THE OWNER'S RULE, BY EXPERIMENT. In rolled-back
transactions with seeded properties/rooms/reservations (copy the setup of supabase/tests/pinned_cleaning.sql and
room_cleanings.sql), try to break it: (1) rooms — A->C, A+B -> C+D, A+B -> B+C, rooms withdrawn to the listing,
a listing-only booking gaining rooms, a stray row with no open place, a started (in_progress) row on the old room
next to an unstarted one, a done legacy row on the listing (the insert's listing branch); assert same row id,
same cleaner, unique index never hit, nothing owed left without a cleaning, nothing cancelled that is owed.
(2) dates — arrival-only change, extension, shortening, a move by the manager then a booking change, a booking
moving out of the -7..+90 night and back, a narrow webhook window vs the wide one ending the same. (3) option B —
arrivals booked into / cancelled from a moved day, on a room, with 00:00 check-in, a "#" arrival, and whether
cleaning_turnover_on and reservation_cleaning_window agree for every case you build. (4) expired/past: a moved
cleaning expiring, a booking moving onto a stale day (task_generation.sql expects the live row to follow it).
(5) guard: an executor through RLS cannot set/clear either column. (6) any test in supabase/tests that now passes
only by accident. Run pinned_cleaning.sql once.`,
  },
  {
    key: 'clients-rollout',
    prompt: `LENS: CLIENTS AND ROLLOUT. (1) Phone (apps/mobile): a task that changes property (room) or day under
a cleaner — list, detail, cached rows (read-cached.ts), the offline queue, photos/steps already taken on it,
the property name/room shown; anything that keys on property_id and goes stale or crashes? (2) Panel: the task
form on a moved cleaning; the calendar branch code that will read the columns later (features/calendar, chips.ts
isBookingChanged/LEFT_BEHIND) — what must change there after the push, list it. (3) The guard: run ONLY the
read-only parts from THIS worktree — node scripts/cloud-read.mjs docs/rollout/remote_head.sql (expect
20260926140000) and npx supabase db push --linked --skip-vault --dry-run (dry run only!) — the list must be
exactly 20260926160000_pinned_cleaning.sql. (4) Locks: the one ALTER now adds two columns and a CHECK that
validates the table — one ACCESS EXCLUSIVE, how long on 6k rows; lock_timeout inside the CLI transaction; cron
need? (5) Grants: in the cloud, new functions get default grants — will cleaning_turnover_on end as
{postgres,service_role} after the migration's revoke? Read pg_default_acl via cloud-read. (6) Run
docs/rollout/postpush_pinned_cleaning.sql locally as supabase_read_only_user in a read-only transaction and check
every label against its header; run docs/rollout/pinned_cleaning_probe.sql on the cloud once and report it.`,
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
