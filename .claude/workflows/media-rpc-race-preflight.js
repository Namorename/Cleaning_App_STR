export const meta = {
  name: 'media-rpc-race-preflight',
  description: 'Adversarial preflight of the media RPC race fix (window 1) before it is pushed to the cloud',
  phases: [
    { title: 'Lenses', detail: 'four independent readings of the migration' },
    { title: 'Refute', detail: 'three skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel + Expo cleaner app).
CLAUDE.md states the rules this repo lives by. The feature plan is docs/chat-plan.md (checklist item 5,
"Решения перед клиентами", bullet "Гонка идемпотентности", describes what was built and why, and the
two deploy windows).

WHAT IS ABOUT TO HAPPEN: supabase/migrations/20260918170000_media_rpc_race.sql is committed locally
and is the ONLY migration of deploy window 1. It redefines two existing security definer RPCs on the
live path of a cleaning's photos — public.add_task_media(...) and public.add_problem_media(...), whose
current cloud bodies are in 20260917110100_task_media_source.sql — and adds one internal helper,
public.task_media_written_meanwhile(p_id uuid, p_step_id uuid, p_problem_id uuid), security definer,
execute revoked from public/anon/authenticated. Signatures of the two RPCs are unchanged. The only
change in their bodies: the final INSERT gets "on conflict (id) do nothing returning *", and when
nothing comes back the row is read again by the helper under the same host / author / owner checks
the lookup at the top of each RPC applies. Nothing else ships in this window: no tables, no policies,
no grants on relations, no chat objects. The cloud currently has every migration through
20260918160000. The three later local files (20260918180000_chat_media, 20260918190000_chat_rpc_race,
20260918200000_chat_media_expiry) are window 2 and must NOT go with this push.

THE DECISIONS YOU ARE CHECKING (approved by the owner 2026-09-18):
  * Two calls with the same phone-made id at the same moment used to give the loser a bare 23505
    (unique_violation, no i18n hint). Now the loser gets the same row back — or serverErrors.mediaNotFound
    when the row written meanwhile belongs to another host, another author or another owner
    (step / problem).
  * The helper compares step_id and problem_id only. When the chat ships (window 2) a message's row
    has both null, so a replayed step/problem write that collides with a chat row is refused, not
    returned. The chat's own writes get their own inline check in 20260918190000.
  * This window ships alone and earlier so the owner can watch the live photo path for a day with one
    user in the system before the chat follows.
  * Tests: supabase/tests/task_media.sql and supabase/tests/problems.sql each end with a block
    "two calls with one id at the same moment" where a BEFORE INSERT trigger plays the other call
    (inserts the same row between the RPC's lookup and its insert); supabase/tests/chat.sql has the
    same for the chat writes plus a cross-tenant case.

TOOLS: the local Supabase stack is UP with the full local schema (INCLUDING window 2) and EMPTY data:
  docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -c "<sql>"
To act as a user (see supabase/tests/task_media.sql, pg_temp.as_user):
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
ALWAYS wrap an experiment in begin; ... rollback; — the stack is shared with other agents. For a REAL
two-session race you may open two docker exec psql processes (one holds a transaction open with
"select pg_sleep(n)" before commit, the other starts a second later); clean up every row you commit
(delete as postgres) and say so. Do NOT touch the cloud (no --linked commands at all). Do NOT modify
repository files.

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
    key: 'race',
    prompt: `LENS: does the race fix hold under a REAL race, not only under the trigger that plays one in the tests.

Seed (as postgres, committed, then deleted at the end): one host, one cleaner profile, one listing,
one in_progress task assigned to her with a photos_before step (see how supabase/tests/task_media.sql
builds these; task_steps come from a workflow template or can be inserted directly), and one open
problem reported by her. Then run two psql sessions as that cleaner with the SAME media id:
session A: begin; select add_task_media(<id>, <step>, 'photo', 'image/jpeg', 1000, ...); select pg_sleep(4); commit;
session B (started 1 s later): select add_task_media(<same id>, <same step>, ...);
Report what B returns (the same row? an error? which SQLSTATE and hint?) and how long it waited. Repeat
with A rolling back instead of committing (B must then insert its own row). Repeat once for
add_problem_media. Then the wrong-owner cases inside one rolled-back transaction, with the trigger
technique from the tests if you like: same id, different step; same id, another author; same id under
another host — each must answer serverErrors.mediaNotFound, never 23505. Finally: does the helper
leak anything? It is security definer and revoked from authenticated — confirm
has_function_privilege('authenticated', 'public.task_media_written_meanwhile(uuid,uuid,uuid)', 'execute')
is false and a direct call as authenticated is refused.`,
  },
  {
    key: 'diff-vs-cloud',
    prompt: `LENS: what exactly changes for the cloud, object by object.

Diff the two RPC bodies in 20260918170000_media_rpc_race.sql against their current cloud bodies in
20260917110100_task_media_source.sql (the last file that defines them): list every differing line.
Anything beyond the insert's "on conflict" clause and the tail after it is a finding. Confirm the
signatures (argument names, types, defaults, return type) are byte-identical, so PostgREST callers and
packages/shared/src/database.types.ts are unaffected — run npm run db:types is NOT allowed (do not
modify files); instead compare the Args of add_task_media / add_problem_media in database.types.ts
with the migration by eye. Confirm that "create or replace function" keeps the existing grants
(execute to authenticated, service_role) — check pg_proc / has_function_privilege on the local stack
for both RPCs and for the helper. Confirm the migration references NO object that the cloud lacks
before window 2: grep it for message_id, chat_, add_message_media, send_message. Confirm the
supabase/tests/table_grants.sql matrix needs no row (a function is not a relation) and passes.`,
  },
  {
    key: 'deploy-mechanics',
    prompt: `LENS: can window 1 actually be pushed alone, and what happens on the day.

  * The Supabase CLI applies EVERY local migration the remote lacks. With 20260918180000/190000/200000
    present in supabase/migrations, "supabase db push" would ship window 2 too. Read the CLI's own help
    (npx supabase db push --help, npx supabase migration --help; NO --linked calls) and say precisely
    how the owner can push ONLY 20260918170000: which flag, or which files must be moved aside (and
    put back, and how the migration history table then looks). Give the exact commands as a recipe.
    If the CLI has no way, the finding is the recipe itself: state it as such.
  * docs/units-plan.md, "Эксплуатация выката", says the cron jobs are paused during a db push. Does
    THIS migration need that? It replaces two functions that the nightly purge-task-media job does
    not call; say which jobs exist (cron.job on the local stack) and whether any calls these RPCs.
  * Skew: the panel and the phone keep their JavaScript; do they call anything whose behaviour
    changes visibly? Read apps/mobile/src/features/media/api.ts addMedia and use-media.ts attachMedia:
    the only visible change is that a replayed call that used to fail with 23505 now succeeds. Is
    there any client code that RELIED on the 23505 (grep both apps for 23505 / unique_violation /
    duplicate)? Say what a phone on the old bundle experiences during and after the push.
  * Rollback: if the owner wants to undo window 1 after a day, what is the exact statement set (the
    two bodies from 20260917110100 plus drop of the helper)? Does anything written during that day
    make the old bodies wrong?`,
  },
  {
    key: 'tests-and-rules',
    prompt: `LENS: the tests and the house rules.

  * Read the blocks "two calls with one id at the same moment" in supabase/tests/task_media.sql and
    supabase/tests/problems.sql, and the trigger pg_temp.other_call_wins(). For each check say what it
    proves and what it would still pass if the fix were WRONG in a plausible way (e.g. if the helper
    skipped the host filter, if it compared created_by with = instead of is distinct from, if the RPC
    returned the trigger's row without re-reading, if "on conflict do nothing" silently swallowed a
    conflict on a DIFFERENT unique index than the primary key — list task_media's unique indexes).
    Name the gaps that matter and propose the smallest check that closes each. Note that the
    cross-tenant case is tested only in chat.sql for the chat write; is it needed for the step write?
  * Run npm run test:rls and report the result.
  * Hold the migration to CLAUDE.md: English only; errors carry an i18n key in hint; the helper is
    revoked from public/anon/authenticated as internal functions should be; grants of the two RPCs are
    not restated (are they preserved? see the diff lens) — say whether the sibling migrations restate
    grants after create or replace and whether this one should for consistency.
  * The comment header of the migration and docs/chat-plan.md (item 5, "Гонка идемпотентности", "Два
    окна выката") must agree with each other and with the code: names, what ships in which window,
    the reason for the split.`,
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
          `Check the finding against the PLAN (docs/chat-plan.md item 5, "Гонка идемпотентности" and "Два окна выката") and the owner's stated decisions: on conflict do nothing plus re-read, the helper knowing only steps and problems, window 1 shipping alone and earlier, the chat writes fixed in window 2. If the finding is really a disagreement with an approved decision, refute it and say which decision it argues with.`,
        ]
        return parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from a preflight of the media RPC race fix.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
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
