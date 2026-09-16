export const meta = {
  name: 'room-cleanings-preflight',
  description: 'Adversarial preflight of the room_cleanings migration before it rewrites 327 live tasks in production',
  phases: [
    { title: 'Lenses', detail: 'eight independent readings of the migration' },
    { title: 'Refute', detail: 'three skeptics per finding, each with a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js panel + Expo cleaner app).
Read CLAUDE.md first; it states the rules this repo lives by.

WHAT IS ABOUT TO HAPPEN: the migration supabase/migrations/20260912150000_room_cleanings.sql
(just committed as 9767d18, NOT yet pushed to the cloud) is about to be applied to PRODUCTION with
  npx supabase db push --linked
and then the Edge Functions that import supabase/functions/_shared/ get redeployed.

STAKES: production holds 327 LIVE cleanings on the nine multi-unit listings. The migration's backfill
REWRITES them (tasks.property_id moves from the listing onto the room), creates extra cleanings for
bookings that took several rooms, and re-times them. A mistake here is not a failed test — it is
cleaners being sent to the wrong flat, or losing work they have already accepted, on a live account.

BACKGROUND YOU NEED:
- Nine of seventy-nine Hostaway listings are multi-unit. A ROOM is a public.properties row with
  hostaway_unit_id NOT NULL, parent_id = the listing, id = 10^12 + hostaway_unit_id.
- public.reservation_units (added 20260912130000) says which rooms a booking took. 475 links, 466 bookings,
  8 bookings took more than one room, one took three.
- 20260912140000 made a room inherit its listing's cleaner (union for visibility, priority for auto-assignment).
- A cleaning used to be identified by reservation_id alone; this migration makes it the PAIR
  (reservation_id, property_id) — in the unique index AND in all four clauses of generate_cleaning_tasks.
- public.reservation_cleaning_window(bigint) was DROPPED and replaced by
  public.reservation_cleaning_window(bigint, bigint). Verified on the local stack: only the two-argument
  form now exists.
- A nightly cron calls the sync Edge Functions; sync-reservations walks ~1290 bookings
  (daysBack=7&daysForward=90) and calls generate_cleaning_tasks.

THE PRECEDENT THAT MAKES THIS WORTH DOING. On the previous stage, this same harness found a bug no local
test could: a new RPC argument defaulted to '[]' (meaning "this booking took no rooms"), and the ALREADY
DEPLOYED old Edge Function, which calls the RPC with the old argument list, therefore ERASED the room
links it had just backfilled — the nightly run would have wiped them by morning. The lesson is in the
project memory as "rpc-new-argument-meets-old-caller": between db push and fn deploy, the database is
called by OLD code, and any default that ASSERTS something destroys data.
The counter-lesson, also recorded ("adversarial-refuters-calibration"): in that same run the skeptics
reflexively refuted real findings. Refute only what the code actually contradicts.

TOOLS: the local Supabase stack is UP and holds this exact schema with EMPTY data. You can run SQL:
  docker exec supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -c "<sql>"
Use it to CHECK claims — function signatures, index definitions, trigger lists, EXPLAIN, or a small
fixture that proves a behaviour. Do NOT touch the cloud. Do NOT modify files in the repository.
`

const LENSES = [
  {
    key: 'backfill',
    prompt: `LENS: the backfill block itself (the do $backfill$ ... $backfill$ at the end of the migration).
Walk it statement by statement against production's shape. Which rows move, which are created, which are re-timed,
which are deliberately untouched? Look for: rows that move when they should not, rows that should move and do not,
a booking whose rooms are only partly resolvable, two live cleanings colliding on the new unique index mid-backfill,
statement ORDER (does a later statement see what an earlier one wrote?), what happens to a cleaning whose booking
has since been cancelled, and whether running the whole migration twice is safe.
Check the actual numbers it implies against the counts given above.`,
  },
  {
    key: 'identity',
    prompt: `LENS: the identity change — a cleaning was named by reservation_id, now by (reservation_id, property_id).
Find the unique index in this migration and in the migrations before it. Does the OLD index get dropped? Can the
NEW index be created on production's CURRENT data without violating it — think about what the backfill leaves behind
and in which order index creation and backfill happen inside the migration. Check every other index, constraint,
foreign key and ON CONFLICT clause that mentions reservation_id. Look for an ON CONFLICT that no longer matches
an existing unique index (that is a runtime error, not a plan error).`,
  },
  {
    key: 'generator',
    prompt: `LENS: generate_cleaning_tasks, all four clauses (insert, reschedule/re-time, hand-over, cancel).
Read the version this migration installs AND the version it replaces (grep the earlier migrations).
For each clause ask: does it still pick the right row now that a booking owns several? Does the left join to
reservation_units fan out or lose rows? Does the temporary table get dropped explicitly (a known past bug:
"relation _wanted already exists" on a second call in one transaction)? Does a booking that took no rooms still
produce exactly one cleaning on the listing? Does anything double-count a parent and its child?`,
  },
  {
    key: 'urgency',
    prompt: `LENS: reservation_cleaning_window(reservation, property) and urgency.
Read the new function and the one it replaces. Is the arriving-guest test correct per room? What happens on an
ordinary listing whose bookings name no rooms — is the answer identical to before (it must be, seventy listings
depend on it)? What about a booking that took two rooms where the next guest comes into only one of them?
Check priority, due_at, time_from/time_to and guests_count. Check the timezone arithmetic and the
"at time zone" expressions for a room whose timezone column may differ from its listing's.`,
  },
  {
    key: 'deploy-order',
    prompt: `LENS: the window between db push and fn deploy, and everything OLD code does to the NEW schema.
The dropped one-argument reservation_cleaning_window is the obvious suspect: grep the whole repository
(supabase/functions, apps/web, apps/mobile, other migrations, views, triggers, RPCs) for every caller of it and of
generate_cleaning_tasks, and decide what an already-deployed caller does the moment the migration lands.
Check every RPC signature this migration changes or adds a default to, against the argument lists the deployed
functions actually send. Remember the precedent above. Say exactly which Edge Functions must be redeployed and why.`,
  },
  {
    key: 'grants-rls',
    prompt: `LENS: privileges, RLS and the grants matrix.
CLAUDE.md: every table's authenticated privileges live in supabase/tests/table_grants.sql and a new table must be
added there in the same migration; grants are always "revoke all" then a pointed grant; anon gets nothing; a policy
is unreachable without a base GRANT. Check every object this migration creates or replaces — tables, indexes,
functions (security definer? search_path? owner? execute grants?). Check that a cleaner can still see and take the
tasks she should, and cannot reach what she should not, now that tasks move onto rooms.`,
  },
  {
    key: 'operations',
    prompt: `LENS: running it on a live database.
How long does the migration hold locks, and on what? Does the backfill lock public.tasks in a way that blocks the
panel or the cleaner's phone? What happens if the nightly cron's sync-reservations runs WHILE the migration is
applying, or immediately after it, with the old Edge Function still deployed? Is the whole migration one
transaction? If it fails halfway, what state is production left in? Is there any statement that cannot run inside
a transaction? Estimate the row counts each statement touches (327 live cleanings, ~1290 bookings, 110 properties).`,
  },
  {
    key: 'human',
    prompt: `LENS: what a person experiences the morning after.
A cleaner has accepted a cleaning for tomorrow on a listing; the backfill moves it onto a room. What does she see
on her phone — the same task, a new one, or none? Does her acceptance, her photos, her checklist progress, her
started clock survive? What about a task a manager assigned by hand to a specific person? What about a task
currently in_progress? What does the manager see in the panel and in the statistics? Read apps/mobile and apps/web
to answer concretely, not by assumption. Report anything that silently loses human work or silently changes what
somebody was told to do.`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          location: { type: 'string', description: 'file:line or SQL object name' },
          mechanism: { type: 'string', description: 'the concrete chain of events, citing the code' },
          consequence: { type: 'string', description: 'what goes wrong in production, concretely' },
          evidence: { type: 'string', description: 'what you actually ran or read that proves it — psql output, a quoted line' },
          fix: { type: 'string', description: 'the smallest correct change' },
        },
        required: ['title', 'severity', 'location', 'mechanism', 'consequence', 'evidence', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    evidence: { type: 'string', description: 'what you ran or read to decide' },
    correction: { type: 'string', description: 'if it stands but is imprecise, the corrected statement' },
  },
  required: ['refuted', 'reason', 'evidence'],
}

const SKEPTICS = [
  'ANGLE 1 — read the code again, literally. Open the cited lines and the surrounding statement in full. Does the SQL really say what the claim says? Quote the exact text. Watch for a claim that ignores a WHERE clause, a COALESCE, a left join or a status filter that is right there.',
  'ANGLE 2 — prove it or kill it on the live local stack. Build the smallest fixture that would exhibit the claimed failure (insert a host, a listing, a room, a booking, a task; call the function) and run it with psql. Report what actually happened. If the fixture does NOT reproduce the failure, that is a refutation; if it DOES, the claim stands and you say so.',
  'ANGLE 3 — does production actually contain the shape this needs? The claim may be true in theory and unreachable in this account: nine multi-unit listings, 31 rooms, 475 room links on 466 bookings, 8 multi-room bookings, 327 live cleanings, zero combined listings. Also check whether an earlier migration or an existing constraint already prevents it.',
]

phase('Lenses')
log(`Eight lenses over the migration, each finding then put to three skeptics`)

const results = await pipeline(
  LENSES,
  (lens) =>
    agent(
      `${CONTEXT}\n\n${lens.prompt}\n\n` +
        `Read supabase/migrations/20260912150000_room_cleanings.sql in full before anything else, and read the ` +
        `migrations it builds on. Verify with psql where you can. Report only what you can point at in the code; ` +
        `an empty findings array is a good answer if your lens finds nothing.`,
      { label: `lens:${lens.key}`, phase: 'Lenses', schema: FINDINGS_SCHEMA, effort: 'high' },
    ),
  (found, lens) => {
    const findings = (found && found.findings) || []
    if (findings.length === 0) return []
    return parallel(
      findings.map((f) => () =>
        parallel(
          SKEPTICS.map((angle, i) => () =>
            agent(
              `${CONTEXT}\n\nA reviewer reports this against the migration:\n\n` +
                `TITLE: ${f.title}\nSEVERITY: ${f.severity}\nWHERE: ${f.location}\n` +
                `MECHANISM: ${f.mechanism}\nCONSEQUENCE: ${f.consequence}\nTHEIR EVIDENCE: ${f.evidence}\n` +
                `PROPOSED FIX: ${f.fix}\n\n` +
                `${angle}\n\n` +
                `Your job is to find out whether it is TRUE, not to win. A previous run of this harness refuted ` +
                `real findings and a data-destroying bug nearly shipped. Say refuted=false when the code supports ` +
                `the claim, and say so plainly.`,
              { label: `skeptic:${lens.key}:${i}`, phase: 'Refute', schema: VERDICT_SCHEMA, effort: 'high' },
            ),
          ),
        ).then((votes) => {
          const real = votes.filter(Boolean)
          return {
            ...f,
            lens: lens.key,
            skeptics: real.map((v) => ({ refuted: v.refuted, reason: v.reason, evidence: v.evidence, correction: v.correction || null })),
            refuted_count: real.filter((v) => v.refuted).length,
            vote_count: real.length,
          }
        }),
      ),
    )
  },
)

const all = results.flat().filter(Boolean)
const order = ['critical', 'high', 'medium', 'low']
all.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))

log(`${all.length} findings raised; ${all.filter((f) => f.refuted_count < 2).length} survived at least two skeptics`)

// Everything is returned, refuted or not: the operator re-reads the serious ones himself.
return {
  findings: all,
  counts: {
    raw: all.length,
    unanimous_refuted: all.filter((f) => f.refuted_count === f.vote_count).length,
    stands: all.filter((f) => f.refuted_count < 2).length,
    critical_or_high: all.filter((f) => f.severity === 'critical' || f.severity === 'high').length,
  },
}
