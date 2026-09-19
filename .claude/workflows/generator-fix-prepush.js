export const meta = {
  name: 'generator-fix-prepush',
  description: 'Adversarial preflight of the generator fix before it is pushed to the cloud alone',
  phases: [
    { title: 'Lenses', detail: 'six independent readings of the migration and of the push procedure' },
    { title: 'Refute', detail: 'three skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel + Expo
cleaner app). CLAUDE.md states the rules this repo lives by and is already in your context.

WHAT IS ABOUT TO HAPPEN — and it is narrow. ONE migration is being pushed to the CLOUD project:
supabase/migrations/20260918171000_generator_respects_expired.sql. It is committed (dd0f164) and
pushed to git. Nothing else rides along. The migration does exactly two things:
  * create or replace public.generate_cleaning_tasks(from_date date, to_date date) returns jsonb,
    identical to the version now in production (20260912150000_room_cleanings.sql) except for ONE
    added disjunct in the insert's NOT EXISTS guard:
        or (t.status = 'expired' and t.scheduled_date = w.scheduled_date)
  * re-issue its grants: revoke all from public, anon, authenticated; grant execute to service_role.

WHY. Measured in production on 2026-09-19 by four read-only queries: 4853 rows of 'expired' cleanings
standing for 769 real departures (multiplier 6.3); 3891 of those rows (80%) are pure duplicates; 741
of 769 bookings carry more than one row, the worst eleven. The loop: the nightly reconciliation window
starts at today-7 (DEFAULT_DAYS_BACK in supabase/functions/sync-reservations/index.ts), 'expired' sits
outside both the partial unique index and the insert's guard, so the generator at 03:15 re-mints the
cleaning the sweep closed at 03:30 the night before. ~160 junk rows a night at this account's size.

MEASURED CLOUD STATE (read-only probe, today, before the push):
  * Applied migrations: everything through 20260918170000 inclusive. Pending: this one plus the three
    window-2 chat files, which are deliberately NOT being pushed.
  * Exactly ONE function named generate_cleaning_tasks exists: public.generate_cleaning_tasks(date,date)
    returns jsonb, owner postgres, acl {postgres=X/postgres,service_role=X/postgres}, security definer,
    volatile, proconfig search_path="". No overloads anywhere in the database.
  * Its body today is md5 b8a4b5ff8f91df5b40cf7dc6afc13d50, 11530 chars — byte-identical to the body in
    20260912150000_room_cleanings.sql. The new body is md5 75e9a6fd61b40bfb7c7bcf0b1fbb9ee5, 11833 chars.
  * Cron in production, all jobs owned by postgres: 'sync-reservations-daily' 15 3 * * * and
    'process-webhook-events' */2 * * * *, both 'select public.invoke_edge_function(...)' — those two
    Edge Functions are what call this RPC, with the service_role key. 'expire-stale-tasks' 30 3 * * *
    calls public.expire_stale_tasks() directly. 'sync-listings-daily' 0 3 * * *, 'purge-task-media-daily'
    30 4 * * *.
  * Other production numbers from the same probe: 4940 cleanings dated in the past, 4853 of them expired;
    only 49 live rows stand in the past and all are inside the legal grace day. 110 active properties,
    65 of them reachable by nobody (no property_cleaners link); 555 of 777 live cleanings stand on those
    unreachable properties with no assignee.

THE PUSH PROCEDURE, which is itself under review:
  1. tree clean, everything pushed — verified; sha256 of all four pending migration files recorded.
  2. the three window-2 files (20260918180000_chat_media.sql, 20260918190000_chat_rpc_race.sql,
     20260918200000_chat_media_expiry.sql) are temporarily MOVED OUT of supabase/migrations into the
     session scratchpad, so that db push cannot pick them up. They are moved back afterwards and their
     sha256 compared byte for byte. During YOUR run they are still in place.
  3. npx supabase migration list --linked, then npx supabase db push --dry-run: the dry run must name
     EXACTLY ONE file. Anything else and the push is abandoned.
  4. npx supabase db push.
  5. after: verify in the cloud that there is still exactly one signature, no overload, the same EXECUTE
     grants, and that the body hash is now 75e9a6fd61b40bfb7c7bcf0b1fbb9ee5.
  6. no OTA update, no Edge Function redeploy, no Vercel deploy.

WHAT WAS ALREADY PROVEN LOCALLY (do not redo it, attack it instead): db:reset, test:rls 25 suites,
db:types with no diff, typecheck and lint both apps, test:web 414, test:mobile 357, test:fn 166,
build:web — all green, twice. 12 new checks in supabase/tests/task_generation.sql cover three
consecutive nights, a shifted departure, and a return to a day already tried; the suite was shown to
go red by restoring the old body in the live database.

DECISIONS ALREADY MADE BY THE OWNER — a finding that merely disagrees with one of these is not a
finding:
  * The guard is keyed on the TRIPLE (reservation, property, scheduled_date), not the pair. A departure
    that moved to a new day is real work and must still be created; the same day has already been
    answered.
  * A guard inside the function, NOT a unique index. On the pair an index forbids the rescheduled
    departure (the regression 20260904120100 deliberately removed); on the triple it forbids the
    legitimate record of two attempts on one day; and no form of it can be built on today's rows, which
    run up to eleven per booking. An index, in the form 'where status = expired', comes only after the
    duplicates are cleaned, and cleaning live rows is the owner's call.
  * Migrations never delete production data. The 3891 accumulated duplicates stay until the owner says
    otherwise; this push does not touch a single row.
  * The migration is numbered 20260918171000 — between window 1 and window 2 — precisely so it can be
    pushed alone and still leave a natural order when window 2 eventually goes.
  * Window 2 (chat media) is paused until after the launch with the cleaners. It must not be pushed.

HOUSE RULES THAT BITE HERE (from CLAUDE.md): schema changes only through migrations; an RLS policy is
unreachable without a base GRANT; client role grants are explicit only; the cloud hands new tables a
fuller set of default privileges than the local stack does, so grants must be re-verified in the cloud
after every db push; user-facing text never lives on the server.

TWO RECORDED LESSONS FROM EARLIER RUNS OF THIS HARNESS:
  * 'rpc-new-argument-meets-old-caller': a new RPC argument defaulted to a value that ASSERTED something
    ('this booking took no rooms'), and the already-deployed old Edge Function erased the links it had
    just written. Ask the same question here: the deployed callers are NOT being redeployed, so does the
    new body still answer them correctly?
  * 'adversarial-refuters-calibration': in an earlier run the skeptics refuted almost everything because
    the prompt framed refutation as the goal. Judge on the merits. An empty findings array is a fine
    answer and is better than padding. Do not invent a defect to have something to say.

YOUR CONSTRAINTS, absolute:
  * READ ONLY. Do NOT touch the cloud in any way — no supabase CLI, no psql to the remote, nothing.
  * Do NOT modify, create or delete repository files. Do NOT run any git command that writes.
  * You MAY read files freely. You MAY run read-only SQL against the LOCAL stack:
      docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -c "<sql>"
    The local stack holds schema HEAD (which already contains this migration AND window 2) and EMPTY
    data. It is SHARED with the other agents of this run: wrap anything that writes in
    begin; ... rollback;, and never leave a row behind. If docker is not running, do not start it —
    fall back to reading files.
  * Cite file:line. Do not paste large blocks of SQL into your answer; name where it lives.
`

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      description: 'Only real defects. An empty array is a fine answer and is better than padding.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          where: { type: 'string', description: 'file:line or object name.' },
          what: { type: 'string', description: 'What goes wrong, concretely, in production.' },
          how_seen: { type: 'string', description: 'The reading or experiment that shows it. Name what you ran and what came back; do not paste large output.' },
          fix: { type: 'string', description: 'The smallest change that closes it. If the answer is "abandon the push", say that.' },
        },
        required: ['title', 'severity', 'where', 'what', 'how_seen', 'fix'],
      },
    },
    verified: {
      type: 'array',
      items: { type: 'string' },
      description: 'Claims you CHECKED and found sound, so a reader does not re-check them.',
    },
  },
  required: ['lens', 'findings', 'verified'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    better_fix: { type: 'string' },
  },
  required: ['angle', 'refuted', 'reason', 'better_fix'],
}

const LENSES = [
  {
    key: 'body-diff',
    prompt: `LENS 1 — THE DIFF, CHARACTER BY CHARACTER.

The claim under test: the new body differs from the one now running in production by exactly one
disjunct and by comments, and by nothing else.

  * Diff the function body in supabase/migrations/20260912150000_room_cleanings.sql (the version the
    cloud runs today) against the one in
    supabase/migrations/20260918171000_generator_respects_expired.sql. The expected delta is +303
    characters of body. Account for every character of it.
  * Every pass of the function matters: the relocate pass, the insert, the reschedule pass, the
    hand-over pass, the cancel pass, the temporary table _wanted, and the returned jsonb keys. Confirm
    each is unchanged, or name what changed.
  * Look for changes that are invisible in a casual read: a flipped comparison, a moved parenthesis
    that changes operator precedence in the NOT EXISTS guard, a renamed alias, a lost cast, a changed
    order of coalesce arms, a different status list.
  * The new disjunct sits inside a larger AND/OR expression. Work out its precedence by hand and say
    exactly which rows the guard now suppresses that it did not before, and which it does not.
  * Confirm the returned jsonb keys and their names are unchanged — both Edge Functions read that
    object and are NOT being redeployed.`,
  },
  {
    key: 'window2-isolation',
    prompt: `LENS 2 — IS THIS MIGRATION REALLY INDEPENDENT OF WINDOW 2?

The claim under test: 20260918171000 can be applied to a cloud that has everything through
20260918170000 and nothing after it.

  * List every database object the migration's body reads or writes: tables, columns, types, enums,
    functions, indexes, constraints. For each, find the migration that created it and confirm its
    version is <= 20260918170000. supabase/migrations/ is the whole source of truth.
  * Pay attention to columns added late: properties.hostaway_unit_id, properties.parent_id,
    properties.status, property_cleaners.mode, reservation_units, reservation_cleaning_window,
    public.task_status, tasks.due_at, tasks.guests_count.
  * Confirm the migration references nothing created by the three window-2 files
    (20260918180000_chat_media.sql, 20260918190000_chat_rpc_race.sql, 20260918200000_chat_media_expiry.sql)
    and that those three reference nothing this one creates, in either direction.
  * The local stack was reset with ALL of them applied, so a hidden dependency would not have shown up
    locally. That is exactly the gap you are closing: reason from the migration files, not from the
    local database.
  * Also check the reverse ordering risk: when window 2 is eventually pushed on top, does having
    20260918171000 already applied change anything for those three files?`,
  },
  {
    key: 'grants-and-callers',
    prompt: `LENS 3 — PRIVILEGES, OWNERSHIP AND THE CALLERS THAT ARE NOT BEING REDEPLOYED.

  * The migration's tail is 'revoke all on function ... from public, anon, authenticated' then
    'grant execute ... to service_role'. Production ACL today is {postgres=X/postgres,service_role=X/postgres}.
    Work out the ACL immediately after the push and say whether it is identical. Does create or replace
    preserve owner and ACL? Does the revoke touch anything that is currently granted?
  * Who actually calls this RPC in production: supabase/functions/sync-reservations/index.ts and
    supabase/functions/process-webhook-events/index.ts, both with the service_role key, driven by cron
    through public.invoke_edge_function. Neither Edge Function is being redeployed. Confirm the call
    shape still matches: argument NAMES (from_date, to_date), argument types, and the shape of the
    returned jsonb that the callers destructure.
  * security definer with search_path = '' means every identifier inside must be schema-qualified.
    Check the NEW line specifically, and check that nothing in the file relies on a search path.
  * Does supabase db push wrap a migration file in a transaction? If it does, is there any instant at
    which service_role lacks EXECUTE? If it does not, is there? Answer from the CLI's actual behaviour,
    not from hope.
  * 'process-webhook-events' runs every two minutes and calls this function. What happens if the replace
    lands while a call is in flight — for the in-flight call, for the replace, and for the next call?
    Name the lock create or replace function takes and on what.
  * CLAUDE.md requires table grants to be re-verified in the cloud after a push. This migration adds no
    relation. Say whether supabase/tests/table_grants.sql needs a row, and whether anything in the cloud
    grant matrix can shift as a side effect of this push.`,
  },
  {
    key: 'first-night',
    prompt: `LENS 4 — WHAT THE FIRST NIGHT ACTUALLY DOES, ON THE REAL TABLE.

Production holds 4853 expired cleanings over 769 departures, 49 live rows in the past (all inside the
legal grace day), 777 live cleanings of which 555 stand on properties nobody is linked to.

  * Walk the 03:15 run after the push, pass by pass, over that data. What changes relative to the run
    the night before? Quantify where you can.
  * The danger to hunt: work that is genuinely owed and will now NOT be created. Construct the cases and
    test each against the guard — a departure that moved to a new day; a booking that came back after
    its first attempt expired; a second attempt on the same day; a cleaning that expired on a listing
    while the booking now names rooms, and the mirror case; a booking whose property went to maintenance
    and back; a departure exactly on the grace boundary.
  * Does the new disjunct interact with the relocate pass or the cancel pass in a way the insert's
    author did not intend? The cancel pass judges by the pair (reservation, property) — can a row the
    guard now suppresses leave the cancel pass free to cancel something live?
  * The 555 cleanings on unreachable properties will expire one day and then, under the new body, never
    be re-created for that day. Is that the right outcome, or does it turn a missing link into silently
    lost work? Say plainly what the owner is signing up for.
  * You may build these cases as synthetic rows on the LOCAL stack inside begin; ... rollback;. Note
    that the local schema already contains this migration. Constraints that will bite you:
    tasks_assigned_has_assignee, properties_unit_id_is_derived.`,
  },
  {
    key: 'rollback-and-blast-radius',
    prompt: `LENS 5 — IF IT GOES WRONG.

  * Is this push reversible? Write the exact rollback: what statement restores the previous behaviour,
    where the previous body is to be found, what happens to the supabase_migrations.schema_migrations
    row, and whether a rollback would itself need a new migration file to keep the repository honest.
  * Does anything in the file write a row, take a heavy lock, rewrite a table, or hold a transaction
    open for long? Estimate the duration of the push on a production database.
  * What happens if the push fails halfway — network drop, statement timeout, a lock wait? Is the
    migration recorded as applied? Is it safe to simply run it again?
  * What is the worst realistic outcome of this push, and how would it be noticed? Name the signal:
    which number, on which screen or in which log, would go wrong first.
  * The function is security definer and owned by postgres, and the CLI connects as a migration role.
    Can create or replace fail on ownership, and what would the error look like?`,
  },
  {
    key: 'push-procedure',
    prompt: `LENS 6 — ATTACK THE PROCEDURE, NOT THE SQL.

The operator will physically move three files out of supabase/migrations, run the CLI, and move them
back. Find what can go wrong in that, concretely, with this CLI (supabase 2.115.0) and this project.

  * Does 'supabase db push' push every pending local migration, or only the next one? What does
    '--dry-run' print exactly, and can it under-report? Is there any flag (--include-all and friends)
    whose absence or presence changes which files are taken?
  * With the three files absent from the directory, does the CLI notice a mismatch between local files
    and the remote history table, and does it refuse, warn, or proceed? Remember: those three were never
    applied remotely, so nothing remote is missing locally — confirm that this is the harmless
    direction.
  * When window 2 is pushed later, will the CLI object that 20260918180000 is older than nothing it has
    applied? Work out whether a later push of the three files is still ordinary, given 20260918171000
    sits below them.
  * Does 'db push' do anything besides migrations — seed.sql, config.toml, storage buckets, Edge
    Functions, roles? Prove it either way. The owner has explicitly forbidden an Edge Function redeploy,
    a Vercel deploy and an OTA update in this window.
  * The three files are moved to the session scratchpad and moved back, then compared by sha256. What
    could silently change their bytes on Windows (line endings, encoding, an editor hook, a formatter,
    git's autocrlf on a checkout)? Which of those would a sha256 comparison catch, and which would it
    not?
  * Is there a safer procedure that achieves the same thing without moving files at all? If yes, say
    whether it is worth switching to at this point.`,
  },
]

phase('Lenses')

const results = await pipeline(
  LENSES,
  (l) => agent(`${CONTEXT}\n\n${l.prompt}`, { label: `lens:${l.key}`, phase: 'Lenses', schema: FINDING_SCHEMA }),
  (report, l) => {
    if (!report || !report.findings || report.findings.length === 0) {
      return { key: l.key, verified: report ? report.verified : [], confirmed: [], dropped: [] }
    }
    return parallel(
      report.findings.map((f) => () => {
        const ANGLES = [
          `Try to REFUTE this finding by reading the actual files, and by experiment on the local stack where that is cheap. If it does not reproduce, refute it. If it reproduces but no real caller can reach it — no cron job, no Edge Function, no policy, no app path — refute it as unreachable and say why. If it reproduces and is reachable, say so plainly and do not refute.`,
          `Assume the finding is real and attack the FIX instead. Does the proposed fix close it without opening something else, without breaking a house rule, and without putting the same rule in two places? If the fix is wrong, give the better one. Refute only if the fix would make things worse, or if the severity is overstated by more than one level.`,
          `Judge the finding against the owner's approved decisions and against the scope of this push: guard on the triple rather than an index, migrations never delete production data, the duplicates stay until the owner says otherwise, window 2 stays unpushed, no OTA and no Edge Function redeploy. If the finding is really a disagreement with one of those decisions, or is about work outside this push, refute it and name the decision it argues with. If it is a genuine defect inside the scope, do not refute it.`,
        ]
        return parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from the preflight of the generator fix.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
              { label: `refute:${l.key}:${f.severity}:${i + 1}`, phase: 'Refute', schema: VERDICT_SCHEMA },
            ),
          ),
        ).then((votes) => {
          const live = votes.filter(Boolean)
          const against = live.filter((v) => v.refuted).length
          return { finding: f, lens: l.key, refutedBy: against, survives: against < 2, verdicts: live }
        })
      }),
    ).then((judged) => ({
      key: l.key,
      verified: report.verified || [],
      confirmed: judged.filter(Boolean).filter((j) => j.survives),
      dropped: judged.filter(Boolean).filter((j) => !j.survives),
    }))
  },
)

const out = results.filter(Boolean)
const confirmed = out.flatMap((r) => r.confirmed)
const bySeverity = (s) => confirmed.filter((c) => c.finding.severity === s).length
log(
  `confirmed: ${confirmed.length} (critical ${bySeverity('critical')}, high ${bySeverity('high')}, ` +
    `medium ${bySeverity('medium')}, low ${bySeverity('low')}); dropped ${out.flatMap((r) => r.dropped).length}`,
)

return out
