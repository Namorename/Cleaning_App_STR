export const meta = {
  name: 'chat-window2-preflight',
  description: 'Adversarial preflight of the three chat-media migrations of window 2 before they are pushed to the cloud',
  phases: [
    { title: 'Lenses', detail: 'six independent readings of the three migrations' },
    { title: 'Refute', detail: 'three skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel + Expo
cleaner app). CLAUDE.md states the rules this repo lives by. The feature plan is docs/chat-plan.md;
"Эксплуатация выката" describes how these migrations are deployed and how window 1 was deployed.

WHAT IS ALREADY IN THE CLOUD: everything up to and including 20260918170000_media_rpc_race.sql, pushed
2026-09-18 as "window 1". That migration added public.task_media_written_meanwhile(uuid, uuid, uuid)
and rewrote add_task_media and add_problem_media so that two calls with the SAME id cannot both insert:
on conflict (id) do nothing, then re-read with an owner/author check, plus a second lookup by id
immediately after the row lock (a real two-session race showed the loser was otherwise charged
mediaLimitReached for its own file). Grants were verified in the cloud afterwards: task_media has
SELECT for authenticated and nothing for anon; add_task_media / add_problem_media are security definer
with EXECUTE for authenticated and service_role, one signature each.

WHAT IS ABOUT TO BE PUSHED — window 2, three files, in this order:
  * supabase/migrations/20260918180000_chat_media.sql — task_media.message_id (FK to chat_messages,
    on delete cascade); task_media_one_owner rewritten to a three-way XOR (step / problem / message);
    partial index task_media_message_idx; a THIRD permissive select policy on task_media,
    "message media is read by whoever reads the message"; add_message_media; remove_task_media
    rewritten to cover all three owners; retention (task_media_to_purge) extended to message rows.
  * supabase/migrations/20260918190000_chat_rpc_race.sql — chat_media_written_meanwhile(uuid, uuid)
    and the same race fix inside send_message and add_message_media. It does NOT touch add_task_media
    or add_problem_media: those went out with window 1 and must stay as they are in the cloud.
  * supabase/migrations/20260918200000_chat_media_expiry.sql — chat_media_upload_window(), a sweep
    that marks a message photo whose file never arrived (24 h, run daily, so 24–48 h in practice),
    add_message_media and confirm_task_media answering messageMediaExpired for such a row.

THE CLIENTS: the phone's layer-5 client (commit ce2c1ba) and the panel's (commits 5a04752, 16c00a9,
86a8b2c) are COMMITTED but NOT deployed — no OTA, no Vercel deploy. Both call things that only exist
after these migrations (task_media embedded on chat_messages, add_message_media). The deploy order is
therefore cloud first, then Vercel, then OTA. What is LIVE today is the previous panel build and the
phones in the field.

THE DECISIONS YOU ARE CHECKING (approved by the owner):
  * A photo of a message is a task_media row with message_id set and the other three owners null; one
    row, one owner. There is no separate table.
  * The hole a reader sees is drawn by the ROW, never by chat_messages.media_expected. That column is
    only a licence (a wordless message is legal) and a cap on how many photos may be registered.
  * The gallery switch is deliberately NOT enforced for a message; source is still recorded.
  * An unconfirmed message row expires after chat_media_upload_window() and the whole chain then
    answers one key, serverErrors.messageMediaExpired.
  * The migration comment on the new policy CLAIMS: "For a step's or a problem's row the first test is
    false and the rest is never evaluated, so the reads every task screen makes are not made longer."
    That claim is the one the owner has asked to be measured. Postgres does not promise left-to-right
    evaluation of AND, and permissive policies are OR-ed together.

TOOLS: the local Supabase stack is UP with the FULL schema (all four migrations applied) and EMPTY
data:
  docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -c "<sql>"
A dump of production data from 2026-09-12 (thin: about two task_media rows) can be loaded onto the HEAD
schema from
  %LOCALAPPDATA%\\Temp\\claude\\C--Users-Roman-Desktop-Cleaning-App\\a858b341-2206-404b-8b45-e530fdb94832\\scratchpad\\prod_data.sql
To act as a user (see supabase/tests/chat.sql, pg_temp.as_user):
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
ALWAYS wrap an experiment in begin; ... rollback; — the stack is SHARED with other agents. Inside one
transaction now() is constant: to age a row, move its timestamp by hand as postgres rather than waiting.
Do NOT touch the cloud. Do NOT modify repository files.

CALIBRATION (project memory "adversarial-refuters-calibration"): skeptics have reflexively refuted real
findings before, and lenses have padded reports with non-defects. Refute only what the code actually
contradicts; report only what you have SEEN. An empty findings list is a fine answer.
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
          what: { type: 'string', description: 'What goes wrong, concretely.' },
          how_seen: { type: 'string', description: 'The experiment or reading that shows it. Name the SQL you ran and what came back; do not paste large output.' },
          fix: { type: 'string', description: 'The smallest change that closes it.' },
        },
        required: ['title', 'severity', 'where', 'what', 'how_seen', 'fix'],
      },
    },
    measurements: {
      type: 'array',
      description: 'Numbers you actually measured, one line each: what was run, on how many rows, what it cost. Empty if this lens measured nothing.',
      items: { type: 'string' },
    },
    verified: { type: 'array', items: { type: 'string' }, description: 'Claims you CHECKED and found sound, so a reader does not re-check them.' },
  },
  required: ['lens', 'findings', 'measurements', 'verified'],
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
    key: 'cost-step-media',
    prompt: `LENS (the one the owner asked for by name): what the THIRD policy on task_media costs the
reads that every task screen already makes.

This has been open since layer 5 was designed and it touches the live path: a cleaner opening a task
and a manager opening a task drawer both read task_media by task_id / step_id, and those reads happen
constantly. The migration comment claims the new policy costs them nothing because "the first test is
false and the rest is never evaluated". Permissive policies are OR-ed, and Postgres may reorder the
AND arms of each by cost, so the claim has to be measured, not read.

Seed inside a rolled-back transaction, on the HEAD schema: one host, 3 managers, 25 cleaners with
property_cleaners rows over 100 properties, 2000 tasks with steps, 400 problems, 1500 chat threads,
30000 chat messages, and about 20000 task_media rows split realistically — say 16000 on steps, 3000 on
problems, 1000 on messages; analyze.

Then, as a CLEANER (her own tasks) and as a MANAGER, run and compare:
  * explain (analyze, buffers, timing on) of the exact select the phone sends
    (apps/mobile/src/features/media/api.ts fetchTaskMedia: task_media by task_id, deleted_at is null,
    purged_at is null) and the exact selects the panel sends
    (apps/web/src/features/problems/api.ts fetchProblemPhotos and fetchFixTaskSteps).
  * the SAME queries with the new policy dropped inside the transaction
    (drop policy "message media is read by whoever reads the message" on public.task_media),
    so you have a before and an after on identical data.
Report both numbers and the plan shape: is the new policy's exists() subplan present in the plan for a
step row at all; is it an InitPlan/SubPlan evaluated per row; how many rows it is evaluated for; does
the planner short-circuit on "message_id is not null" as the comment claims. State plainly whether the
comment is TRUE, TRUE-BUT-FRAGILE, or FALSE, and if it is not simply true, give the smallest change
that makes the cost provable (for example ordering the policy so the cheap null test is a separate
guard, or an index that makes the subplan free).
Also measure the message-media read itself: the embed the two clients send
(chat_messages with task_media(...) filtered on deleted_at and purged_at) for the busiest thread, and
say what it costs a manager and a cleaner.`,
  },
  {
    key: 'access',
    prompt: `LENS: what the new policy lets through that the old two did not.

The policy is:
  message_id is not null and host_id = current_host_id() and is_active_user()
  and exists (select 1 from public.chat_messages cm where cm.id = task_media.message_id)
It is a POLICY expression, so the exists() is evaluated as the CALLER and the message row is filtered
by the caller's own policies on chat_messages, which defer to chat_threads and chat_participates.
Verify that this is actually so rather than assumed — build, inside one rolled-back transaction, two
hosts, managers and cleaners, tasks (assigned, on a cleaner's listing, beyond the horizon, another
host's), a problem with a repair, a direct thread, messages with photos, and then for every caller
(manager A, cleaner A1, cleaner A2, manager B, a deactivated profile, an auth.uid() with no profile,
service_role, anon) compare
  select id from task_media where message_id is not null
against the set of message photos the caller should be able to see, derived from what the same caller
can select from chat_messages. Any extra row is a leak; any missing row is a hole in the feature.
Specifically try: a photo of a message in a thread whose task is beyond the caller's horizon; a photo
in a direct thread whose subject was promoted to manager; a photo whose message was deleted; a row
with message_id set and host_id of the OTHER host. Check the storage side too: the upload policy
(can_upload_task_media) and the read path for a chat object — can a caller sign or fetch an object
whose row she cannot read? Also confirm the two OLD policies did not widen: a step row must still be
visible exactly to the assignee and managers.`,
  },
  {
    key: 'live-rows',
    prompt: `LENS: what these three files do to a table that already holds production rows, and how
long they hold a lock.

  * task_media_one_owner is DROPPED and re-added. Adding a check constraint validates every existing
    row and takes ACCESS EXCLUSIVE meanwhile. Load the 2026-09-12 production dump onto the HEAD schema
    (it is thin, so also reason about the real table: the cloud has a handful of task_media rows today,
    but say what the cost would be at 20000 and at 200000 rows) and answer: how many live rows would
    FAIL the new constraint (the expected answer is zero — prove it with a query against the dump, and
    write the same query so the owner can run it against the cloud), and how long the table is locked.
  * message_id is added as a nullable column with a FOREIGN KEY. Adding an FK takes SHARE ROW
    EXCLUSIVE on both tables and validates existing rows; with message_id null everywhere that should
    be instant — confirm it, and confirm the column addition itself does not rewrite the table.
  * task_media_message_idx is a partial index created WITHOUT concurrently. Say what that blocks and
    for how long on a table of the real size.
  * Retention: read task_media_to_purge and the purge-task-media function, and say what happens to a
    message row that has no task and no problem — which subject ages it, and can a row become
    unreachable by every branch and so live forever.
  * Say plainly whether cron must be paused for this push, and why. The window-1 recipe said it must
    not be; these three files are not the same shape.`,
  },
  {
    key: 'shared-functions',
    prompt: `LENS: the two functions window 2 rewrites that the LIVE step and problem path already
depends on, and the interplay with what window 1 put in the cloud.

  * remove_task_media is rewritten in 20260918180000 to cover three owners. Read the version currently
    in the cloud (20260907160100 as amended by later migrations up to 20260918170000 — reconstruct it
    from the migrations) and diff the behaviour for a STEP row and a PROBLEM row: who may call it, what
    it refuses, what it returns, what it stamps. Any change to the step or problem path is a change to
    a path that is live today and was not asked for.
  * confirm_task_media is rewritten in 20260918200000. Same exercise: for a step row and a problem row,
    is the answer identical to what the cloud does now, including the order of its checks and the
    mediaNotUploaded / mediaNotFound wording?
  * Window 1 is already in the cloud. Prove that applying these three files does NOT revert it: grep
    them for add_task_media, add_problem_media and task_media_written_meanwhile, and after applying
    them locally compare the bodies of add_task_media and add_problem_media (pg_get_functiondef)
    against the bodies 20260918170000 installs. Report any difference at all.
  * chat_media_written_meanwhile and task_media_written_meanwhile are twins. Read both and say whether
    the chat one applies the same checks (same host, same owner, same author) and whether a caller can
    use the chat path to learn about a row it does not own.
  * send_message gained the race fix. Check that its signature and its answer for the ordinary case are
    unchanged, because the panel that is live today calls it.`,
  },
  {
    key: 'expiry-and-skew',
    prompt: `LENS: the expiry rule, and the days when the cloud is ahead of the clients.

  * Read chat_media_upload_window() and the sweep in 20260918200000. Confirm on the local stack, in a
    rolled-back transaction with timestamps moved by hand, that: a confirmed photo is never touched; an
    unconfirmed message photo younger than the window is not touched; one older is marked; a marked row
    answers messageMediaExpired from add_message_media and from confirm_task_media; the bucket refuses
    its path afterwards; remove_task_media still gives it up. Say what the real worst case is between
    the window and the daily run, and whether a photo can expire while its file is mid-upload.
  * A STEP or PROBLEM row must NOT be swept by this rule. Prove it.
  * Deploy skew: the cloud gets these three files first; Vercel and OTA follow. For the PREVIOUS panel
    build and the phones in the field, list everything they call that these migrations touch
    (send_message, confirm_task_media, remove_task_media, the task_media selects, the storage policies)
    and say for each whether the answer changes. Anything that changes for an old client is a finding.
  * Then the other direction: the NEW panel build (apps/web/src/features/chat) and the NEW phone build
    call task_media embedded on chat_messages and add_message_media. Confirm from
    packages/shared/src/database.types.ts and the two api.ts files that their call shapes match the
    functions these migrations install — argument names, argument order, nullability of every column
    the zod schemas parse. A column the schema marks non-null that the server may return null for
    empties the screen without any error.`,
  },
  {
    key: 'tests-and-rules',
    prompt: `LENS: the tests and the house rules.

  * Read the layer-5 blocks in supabase/tests/chat.sql, supabase/tests/task_media.sql and
    supabase/tests/problems.sql. For each check say what it proves, and what it would STILL pass if the
    code were wrong in a plausible way: if the new policy omitted the host test; if the XOR allowed two
    owners; if the sweep also took step rows; if add_message_media counted deleted rows toward the cap;
    if chat_media_written_meanwhile skipped the author check. Name the gaps that matter and give the
    smallest check that closes each. Note explicitly that there is NO test for a race on a chat photo
    between two hosts, and say whether that matters.
  * Run npm run test:rls and report the result.
  * table_grants: these files add no relation, but they add functions. Confirm the matrix in
    supabase/tests/table_grants.sql still passes and that task_media's row there is still correct after
    a column is added. Confirm every new function follows the house form: revoke all from public, anon;
    grant execute to authenticated, service_role.
  * Hold all three files to CLAUDE.md: English names, comments and error messages; every raise carries
    a stable i18n key in hint and its parameters as JSON in detail; every key used exists in all three
    locale files (packages/shared/src/i18n/locales/*.json) — check messageMediaExpired, messageNotFound,
    messagePhotoLimit, mediaTypeInvalid, mediaSizeMissing, mediaTooLarge, mediaNotFound, mediaNotUploaded.
  * docs/chat-plan.md describes layer 5 and the two windows. Check that what it says matches what these
    three files actually do, and name any sentence that has gone stale.`,
  },
]

phase('Lenses')

const results = await pipeline(
  LENSES,
  (l) => agent(`${CONTEXT}\n\n${l.prompt}`, { label: `lens:${l.key}`, phase: 'Lenses', schema: FINDING_SCHEMA }),
  (report, l) => {
    if (!report || !report.findings || report.findings.length === 0) {
      return {
        key: l.key,
        verified: report ? report.verified : [],
        measurements: report ? report.measurements : [],
        confirmed: [],
        dropped: [],
      }
    }
    return parallel(
      report.findings.map((f) => () => {
        const ANGLES = [
          `Try to REFUTE this finding by experiment. Reproduce it on the local stack exactly as described in how_seen. If it does not reproduce, say so and refute. If it reproduces but is unreachable from any real caller (no policy, no RPC, no app path can get there), refute it as unreachable and say why. For a finding about COST, re-run the measurement yourself on your own seed before you accept or refute the number.`,
          `Accept that the finding is real and attack the FIX instead. Does the proposed fix close it without opening something else, without breaking a house rule, and without adding a second place where a rule is written? Would it force a change to window 1, which is already in the cloud? If the fix is wrong, give the better one. Refute only if the fix would make things worse or the severity is overstated by more than one level.`,
          `Check the finding against the PLAN (docs/chat-plan.md) and the owner's stated decisions: one row with one owner, the hole drawn by the row and not by media_expected, the gallery switch deliberately not enforced for a message, one messageMediaExpired for the whole chain, a photo lost silently when a mutation is dropped before registration. If the finding is really a disagreement with an approved decision, refute it and say which decision it argues with.`,
        ]
        return parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from the preflight of window 2.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
              { label: `refute:${l.key}:${f.severity}:${i + 1}`, phase: 'Refute', schema: VERDICT_SCHEMA },
            ),
          ),
        ).then((votes) => {
          const live = votes.filter(Boolean)
          const against = live.filter((v) => v.refuted).length
          return { finding: f, refutedBy: against, survives: against < 2, verdicts: live }
        })
      }),
    ).then((judged) => ({
      key: l.key,
      verified: report.verified || [],
      measurements: report.measurements || [],
      confirmed: judged.filter(Boolean).filter((j) => j.survives),
      dropped: judged.filter(Boolean).filter((j) => !j.survives),
    }))
  },
)

const out = results.filter(Boolean)
const confirmed = out.flatMap((r) => r.confirmed)
const bySeverity = (s) => confirmed.filter((c) => c.finding.severity === s).length
log(`confirmed: ${confirmed.length} (critical ${bySeverity('critical')}, high ${bySeverity('high')}, medium ${bySeverity('medium')}, low ${bySeverity('low')}); dropped ${out.flatMap((r) => r.dropped).length}`)
log(`measurements taken: ${out.flatMap((r) => r.measurements || []).length}`)

return out
