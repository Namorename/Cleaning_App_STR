export const meta = {
  name: 'chat-layer4-preflight',
  description: 'Adversarial preflight of the chat unread RPC before it is pushed to the cloud',
  phases: [
    { title: 'Lenses', detail: 'four independent readings of the migration' },
    { title: 'Refute', detail: 'three skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel + Expo cleaner app).
CLAUDE.md states the rules this repo lives by. The feature plan is docs/chat-plan.md (checklist item 4
describes exactly what was built and why).

WHAT IS ABOUT TO HAPPEN: supabase/migrations/20260918160000_chat_unread.sql is committed locally
(bdde288) and about to be pushed to the CLOUD project. It is layer 4 of F29 (chat): ONE new function,
public.chat_unread_threads(p_task_ids uuid[], p_problem_ids uuid[]) — security definer, stable,
search_path '' — returning the caller's threads whose tail is newer than the caller's read marker and
whose last author is not the caller. No new tables, no new grants on relations, no policy changes.
Layer 1 (20260918120000_chat.sql: tables, chat_participates, policies, open_thread, send_message,
mark_thread_read) is ALREADY in the cloud and in use by both apps.

THE DECISIONS YOU ARE CHECKING (approved by the owner 2026-09-18):
  * A definer RPC instead of the planned security_invoker view, because measured: through a view the
    manager's unread count costs 498 ms on 1500 threads (per-row policy calls), the same formula in a
    definer function 1.4 ms; a cleaner asking for the 60 ids on her screen 20 ms.
  * The caller is read ONCE from profiles (must be is_active), the host is the caller's host, the
    marker is joined by (thread_id, profile_id = caller).
  * Managers take a short cut ONLY on task and problem threads (there the manager branch of
    chat_participates is exactly "same host"); a direct thread ALWAYS goes through chat_participates,
    because its subject must still be field staff — somebody promoted out of the field takes her inbox
    out of everyone's reach. This came out of a review an hour ago and has a test.
  * Null arrays = whole company; an empty array = nothing. The panel calls it with no arguments (a
    manager); the phone always passes the ids on its screen.
  * A cleaner calling it with no ids gets a correct but slow answer (chat_participates per row). That
    is documented as a shape layer 6 must not adopt, not as a bug.

TOOLS: the local Supabase stack is UP with this exact schema and EMPTY data:
  docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -c "<sql>"
To act as a user (see supabase/tests/chat.sql, pg_temp.as_user):
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
ALWAYS wrap an experiment in begin; ... rollback; — the stack is shared with other agents. Inside one
transaction now() is constant: to make a thread "newer than a marker" move the marker or the tail by
hand as postgres, do not rely on a fresh send. Do NOT touch the cloud. Do NOT modify repository files.

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
    verified: { type: 'array', items: { type: 'string' }, description: 'Claims you CHECKED and found sound, so a reader does not re-check them.' },
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
    key: 'access',
    prompt: `LENS: who can see what through this function that the policies would hide.

The function is a definer and returns thread ids, subject ids, profile ids and timestamps. Compare it
row by row against what the same caller can SELECT from chat_threads under RLS. Build, inside one
rolled-back transaction, TWO hosts with a manager and two cleaners each, tasks (assigned, free on a
cleaner's listing, beyond the horizon, another company's), a problem with a repair, a direct thread,
messages and markers. Then for each caller (manager A, cleaner A1, cleaner A2, manager B, a
deactivated profile, an auth.uid() with no profile) run:
  select thread_id from chat_unread_threads()             EXCEPT select id from chat_threads
and the same with ids passed. Any row in the difference is a leak. Also check the reverse (a thread
readable under RLS and unread, but missing from the function) for correctness. Try p_task_ids that
name another host's task, a task the caller may not read, a non-existent uuid, and both arrays empty.
Check that a null auth.uid() (service_role / no claims) returns nothing rather than everything.`,
  },
  {
    key: 'cost',
    prompt: `LENS: what this costs, and whether the numbers in the migration comment hold.

Seed inside a rolled-back transaction: one host, 3 managers, 25 cleaners (each covering 4 of 100
properties via property_cleaners), 2000 tasks, 400 problems, 1500 threads, 30000 messages, 5000 read
markers, analyze. Then explain (analyze, timing off) as a manager: chat_unread_threads() with no
arguments; as a cleaner: chat_unread_threads(<ids of her ~60 open tasks>, '{}') and
chat_unread_threads() with nothing. Report actual times and the plan shape (which indexes, whether
chat_participates is evaluated per row and how many rows). Compare with the comment in the migration
(1.4 ms manager, 20 ms cleaner with ids, ~800 ms cleaner without). A finding here is a plan that does
NOT use the partial task_id / problem_id indexes for the id case, or a manager path that still calls
chat_participates. Also check: does the panel's 60-second poll of this function by, say, 5 managers of
the largest host add measurable load? Say what the load is per minute.`,
  },
  {
    key: 'skew-and-clients',
    prompt: `LENS: deploy skew and the two callers.

The cloud gets the migration first; the panel (Vercel) and the phone (OTA) follow minutes later, and
phones that have not fetched the update keep the OLD JavaScript for days.
  * Old clients do not call the new function. Confirm nothing they DO call changed: diff the migration
    against what layer 1 defines — no altered signatures, no dropped or replaced objects.
  * Read the callers: apps/web/src/features/chat/api.ts (fetchUnreadThreads — rpc with NO args) and
    apps/mobile/src/features/chat/api.ts (fetchUnreadThreads — rpc with two arrays). PostgREST turns
    a call without arguments into a call with defaults — verify against the generated types in
    packages/shared/src/database.types.ts that both call shapes match the function signature, and
    that the zod schemas (apps/*/src/features/chat/schema.ts chatUnreadThreadSchema) accept every
    column the function returns and reject none it returns (e.g. a nullable column the schema marks
    non-null would make the screen empty on a row with null — check profile_id / task_id / problem_id
    nullability and last_message_at, which the WHERE guarantees non-null).
  * The phone passes ids of tasks it holds in a PERSISTED cache (AsyncStorage, buster tasks-v6). Can
    a stale id list make the answer wrong or an error? Can 300 ids in a POST body be a problem?
  * The function is called via PostgREST as an RPC with array parameters: run the actual HTTP call
    against the local REST_URL (http://127.0.0.1:54321/rest/v1/rpc/chat_unread_threads) with a real
    JWT if you can mint one from the local JWT secret in supabase status, or explain why you cannot;
    at minimum confirm the function is exposed (grant execute to authenticated) and that anon gets 401/403.`,
  },
  {
    key: 'tests-and-rules',
    prompt: `LENS: the tests and the house rules.

  * Read the block "What is unread (layer 4)" in supabase/tests/chat.sql. For each check, say what it
    proves and what it would still pass if the function were WRONG in some plausible way (e.g. if the
    manager short cut also covered direct threads, if is_active were not checked, if the host join were
    missing, if last_author_id were compared with = instead of is distinct from). Name the gaps that
    matter and propose the smallest check that closes each.
  * Run npm run test:rls and report the result.
  * Hold the migration to CLAUDE.md: English only; errors carry an i18n key in hint (does this function
    raise at all, and should it?); grants revoke public/anon and grant authenticated/service_role as the
    siblings do; the table_grants matrix is untouched because no relation was added — confirm the
    matrix test still passes and that a FUNCTION does not need a row there.
  * docs/chat-plan.md item 4 and the migration comment quote measurements and decisions — check they
    agree with each other and with the code (numbers, the direct-thread rule, null vs empty arrays).`,
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
          `Try to REFUTE this finding by experiment. Reproduce it on the local stack exactly as described in how_seen. If it does not reproduce, say so and refute. If it reproduces but is unreachable from any real caller (no policy, no RPC, no app path can get there), refute it as unreachable and say why.`,
          `Accept that the finding is real and attack the FIX instead. Does the proposed fix close it without opening something else, without breaking a house rule, and without adding a second place where a rule is written? If the fix is wrong, give the better one. Refute only if the fix would make things worse or the severity is overstated by more than one level.`,
          `Check the finding against the PLAN (docs/chat-plan.md item 4) and the owner's stated decisions: definer RPC instead of a view, the manager short cut on work threads only, null vs empty arrays, the phone always passing ids, a cleaner without ids being slow by design. If the finding is really a disagreement with an approved decision, refute it and say which decision it argues with.`,
        ]
        return parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from a preflight of the unread RPC.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
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
      confirmed: judged.filter(Boolean).filter((j) => j.survives),
      dropped: judged.filter(Boolean).filter((j) => !j.survives),
    }))
  },
)

const out = results.filter(Boolean)
const confirmed = out.flatMap((r) => r.confirmed)
const bySeverity = (s) => confirmed.filter((c) => c.finding.severity === s).length
log(`confirmed: ${confirmed.length} (critical ${bySeverity('critical')}, high ${bySeverity('high')}, medium ${bySeverity('medium')}, low ${bySeverity('low')}); dropped ${out.flatMap((r) => r.dropped).length}`)

return out
