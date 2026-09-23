export const meta = {
  name: 'generator-mirror-package-prepush',
  description: 'Adversarial preflight of the two-migration package (generator bound + trace, problem mirror) before it is pushed to the cloud',
  phases: [
    { title: 'Lenses', detail: 'five independent readings of the package and of the push procedure' },
    { title: 'Refute', detail: 'two skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel + Expo
cleaner app). CLAUDE.md states the rules this repo lives by and is already in your context.

WHAT IS ABOUT TO HAPPEN. TWO migrations are pushed to the CLOUD project in one push, both committed and
pushed to git (d5e3728, 8267040):
  1. supabase/migrations/20260923120000_generator_past_bound.sql
     * create table raw.generator_runs (+ index on ran_at, revoke all from public, anon, authenticated);
     * create or replace public.generate_cleaning_tasks(date, date): no cleaning is born for a day
       task_is_stale() calls past grace (the bound sits in the insert only, via the 'owed' CTE), the answer
       gains key past_bound, and the answer is written into raw.generator_runs before return inside
       begin ... lock table raw.generator_runs in row exclusive mode nowait; insert ...; exception when
       others then raise warning ... end;
     * cron.schedule('purge-generator-runs', '45 3 * * *', delete rows older than 90 days).
  2. supabase/migrations/20260923130000_problem_mirror_current_attempt.sql
     * set local lock_timeout = '5s';
     * create or replace public.mirror_problem_status(): only the problem's current attempt speaks; DELETE
       and problem_id moves handled; cancelled problems untouched; archived untouched except done ->
       resolved; problem must be of the task's own host;
     * create or replace trigger tasks_mirror_problem after insert or update of status, problem_id or
       delete on public.tasks;
     * create or replace public.guard_task_fields(): same as 20260910140000 plus 'new.problem_id :=
       old.problem_id' for non-managers;
     * create or replace public.expire_stale_tasks(): same as 20260904120100 plus 'and t.problem_id is
       null' (the sweep never closes repairs — owner's decision);
     * create or replace public.assign_problem(...): same as 20260908130000 plus a refusal of archived
       problems (hint serverErrors.problemArchived).
The migration headers explain every decision and every accepted cost; read them.

MEASURED CLOUD STATE (read-only probe, 2026-09-23 ~17:55 UTC, before the push):
  * Applied: everything through 20260918171000. Pending locally: the two files above AND the three
    window-2 chat files 20260918180000_chat_media.sql, 20260918190000_chat_rpc_race.sql,
    20260918200000_chat_media_expiry.sql, which must NOT ride along (they will be parked outside the
    directory for the push).
  * Function bodies in the cloud are byte-identical to their previous migrations (md5 of prosrc):
    generate_cleaning_tasks 75e9a6fd… (11833) = 20260918171000; mirror_problem_status bd2c6d9f… (851) =
    20260908130000; expire_stale_tasks 3a5e0b6b… (566) = 20260904120100; assign_problem a3dba123… (1986) =
    20260908130000; guard_task_fields eed91fa4… (1823) = 20260910140000. Expected after the push:
    212ec056… (13146), 1dfa717c… (2458), 55f07501… (597), d633c06c… (2185), 0121a161… (1950) — identical
    to the local stack. One signature per name, no overloads.
  * ACLs today: generate_cleaning_tasks and expire_stale_tasks {postgres=X,service_role=X};
    assign_problem {postgres=X,authenticated=X,service_role=X}; guard_task_fields and
    mirror_problem_status {=X,postgres=X,authenticated=X,service_role=X} (trigger functions). All owned by
    postgres, security definer, search_path "".
  * Trigger today: AFTER INSERT OR UPDATE OF status, problem_id ON public.tasks FOR EACH ROW.
  * raw: nspacl {postgres=UC/postgres,service_role=U/postgres}; raw.generator_runs does not exist; the only
    default ACL in raw or global is postgres|raw|r -> {service_role=arwdDxtm/postgres}.
  * cron (all postgres, active): sync-listings-daily 0 3, sync-reservations-daily 15 3,
    expire-stale-tasks 30 3, purge-task-media-daily 30 4, process-webhook-events */2.
  * Data: 6 problems (5 open, 1 resolved), 6 fix tasks, 0 of them live — the sweep change touches no row
    tonight. Webhook batches reaching 'processed': 124-179 a day on full days 16.09-22.09.

THE PUSH PROCEDURE (docs/units-plan.md, "Эксплуатация выката"), itself under review:
  1. window 2 parked in ..\\window2-parked with a sha256 manifest;
  2. one command: the three window-2 files absent AND remote head (docs/rollout/remote_head.sql) =
     20260918171000 AND the dry run lists exactly "20260923120000_generator_past_bound.sql
     20260923130000_problem_mirror_current_attempt.sql" AND only then npx supabase db push --linked
     --skip-vault (the CLI does not ask for confirmation when run by an agent);
  3. after: docs/rollout/postpush_raw.sql, role_table_grants for anon/authenticated in public, cron = six
     jobs, window 2 back and sha256 -c, and if the push stopped on the second file (lock_timeout), the
     recovery written there;
  4. not between 03:10 and 03:50 UTC: the package changes the generator (03:15), the sweep (03:30) and adds
     a purge at 03:45. No OTA (the phone needs nothing); the panel's Vercel deploy is independent.

WHAT WAS ALREADY PROVEN LOCALLY (attack it, do not redo it): db:reset, test:rls 26 suites / 969 checks,
db:types without diff, typecheck both apps, test:web 422, test:mobile 357, test:fn, build:web, eslint.
Mutation runs: the raw closure checks in table_grants.sql go red on each of nine ways to open raw; the
problem_mirror.sql suite fails 13 checks with the old mirror body; the trace survives a held ACCESS
EXCLUSIVE lock (NOWAIT -> 55P03 caught). Two adversarial reviews already ran on the code (their findings
are fixed); this preflight is about the PUSH: the cloud, the order, the first night, the procedure.

DECISIONS ALREADY MADE BY THE OWNER — a finding that merely disagrees with one is not a finding:
  * the generator writes no cleaning for a day task_is_stale() calls past grace; bound in the insert only;
  * the trace lives in raw, written by the generator itself, 90-day retention, caller told by hour and
    window width, no Edge Function change;
  * the sweep never closes repairs (accepted costs listed in the 20260923130000 header);
  * archived problems cannot be assigned; the panel writes only to live tasks (the panel deploy is
    separate and its order vs the push is free);
  * window 2 stays unpushed and gets fresh numbers only at its own rollout; the file numbers stay.

HOUSE RULES THAT BITE HERE (CLAUDE.md): schema only through migrations; hosted default privileges differ
from local, so grants are re-verified in the cloud after the push; db push run by an agent does not ask.

LESSONS FROM EARLIER RUNS: 'rpc-new-argument-meets-old-caller' — the deployed Edge Functions are NOT
redeployed; does everything still answer them correctly? 'adversarial-refuters-calibration' — judge on the
merits; an empty findings array is a fine answer.

YOUR CONSTRAINTS, absolute:
  * READ ONLY. Do NOT touch the cloud — no supabase CLI against the linked project, nothing remote.
  * Do NOT modify, create or delete repository files; no git command that writes.
  * You MAY read files and run SQL against the LOCAL stack:
      docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -c "<sql>"
    It holds schema HEAD (both migrations AND window 2) and empty data, and is SHARED: wrap writes in
    begin; ... rollback;, leave nothing behind.
  * Cite file:line. Do not paste large blocks.
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
          where: { type: 'string' },
          what: { type: 'string', description: 'What goes wrong, concretely, in production.' },
          how_seen: { type: 'string', description: 'What you ran or read, and what came back.' },
          fix: { type: 'string', description: 'The smallest change that closes it, or "abandon the push".' },
        },
        required: ['title', 'severity', 'where', 'what', 'how_seen', 'fix'],
      },
    },
    verified: { type: 'array', items: { type: 'string' }, description: 'Claims you CHECKED and found sound.' },
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
    key: 'bodies-vs-cloud',
    prompt: `LENS 1 — EVERY REPLACED BODY AGAINST THE ONE THE CLOUD RUNS.
The cloud runs, byte for byte, the bodies of: generate_cleaning_tasks from 20260918171000,
mirror_problem_status and assign_problem from 20260908130000, expire_stale_tasks from 20260904120100,
guard_task_fields from 20260910140000. Diff each against its replacement in the package. Account for every
changed line: intended (named in the header) or not. Look for invisible changes — precedence in a WHERE,
a lost cast, a changed status list, an alias, a dropped branch. Confirm the returned jsonb of the generator
keeps every old key (both Edge Functions pass it through as unknown). Confirm create or replace keeps owner,
security definer, search_path and ACL for each, and that the re-issued grants in the files leave every ACL
exactly as measured (list the ACL after the push per function).`,
  },
  {
    key: 'order-and-independence',
    prompt: `LENS 2 — ORDER AND INDEPENDENCE.
From the migration files alone (the local stack has window 2 applied and would hide a dependency): list every
object the two files read or write and the migration that created it; confirm all exist at cloud head
20260918171000 and none comes from window 2. Check the order between the two files (the first creates
raw.generator_runs and the generator; the second replaces the mirror trigger and guard on tasks — does
anything in the first depend on the second or vice versa?). Check the reverse: when window 2 is pushed
later with fresh numbers, does anything in it redefine an object this package changes (e.g. a function it
also replaces), which would silently undo part of this package?`,
  },
  {
    key: 'callers-and-grants',
    prompt: `LENS 3 — CALLERS THAT ARE NOT REDEPLOYED, AND PRIVILEGES IN THE CLOUD.
The Edge Functions (sync-reservations, process-webhook-events), the deployed panel (Vercel, OLD build until
redeployed: its unassign/cancel write by id without the live filter) and the phone (OTA as is) keep running.
For each, walk what changes for it after the push: the generator's new answer key; the sweep no longer
closing repairs; the mirror's new rules under the OLD panel's unassign (a stale click on a finished repair:
what happens now, better or worse than before?); assign_problem's new refusal reaching an old panel (does
it have the key? is the button reachable?); guard_task_fields pinning problem_id for executors (does the
phone ever write problem_id?). Then raw.generator_runs in the CLOUD: given the measured default ACL, what
ACL will it get, and will docs/rollout/postpush_raw.sql's expectations hold? Anything that makes the
post-push check fail spuriously or pass wrongly?`,
  },
  {
    key: 'first-night',
    prompt: `LENS 4 — THE FIRST NIGHT AFTER THE PUSH, MINUTE BY MINUTE, ON THE REAL DATA.
03:00 sync-listings; 03:15 sync-reservations -> generator (bound, trace); 03:30 sweep (repairs skipped;
there are 0 live repairs tonight); 03:45 purge-generator-runs (first run: nothing to delete); every 2 min
process-webhook-events -> generator on batches with bookings (trace rows). What will raw.generator_runs
hold by 09:00 UTC, how to tell the nightly row (docs: 03:15-03:25, window_from ~ ran_at::date - 7), what
past_bound should read on it and on webhook rows, what could make the morning check misread? Walk the
lock story: the generator's lock table ... nowait vs the purge's delete vs autovacuum. Is there anything in
the first night that can fail loudly (an error that rolls back a whole generator run) rather than warn?`,
  },
  {
    key: 'procedure-and-failure',
    prompt: `LENS 5 — THE PROCEDURE AND ITS FAILURE MODES.
Read the guard command in docs/units-plan.md ("Застава сверяет голову облака…") and docs/rollout/*.sql.
Would the one-command guard, as written, run correctly in this shell (Git Bash on Windows, python on PATH,
CLI 2.115 printing json because CLAUDECODE is set)? What does db push do with seeds/roles/vault/config? The
parking: what can change the bytes of the three files on the way out and back, and does the manifest catch
it? lock_timeout in the second file: with process-webhook-events writing tasks every 2 minutes, how likely
is a 5 s wait, and what exactly is the state if it fires (first file committed?) — is the documented
recovery right? Rollback: for each object, where is the previous definition and what would a revert look
like (a new migration forward, never an edit of history)? Anything that makes pushing at ~18-20 UTC today
worse than another hour, apart from the forbidden 03:10-03:50 window?`,
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
          `Try to REFUTE this finding by reading the actual files, and by experiment on the local stack where cheap. If it does not reproduce, or no real caller, cron job or app path can reach it, refute it and say why. If it reproduces and is reachable, do not refute.`,
          `Judge the finding against the owner's decisions and the scope of THIS push (listed in the context). If it only argues with a decision, or is about work outside this push, refute it and name the decision. If it is a genuine defect inside the scope — something that makes pushing now wrong, or the procedure unsafe — do not refute it, and say whether it must be fixed before the push or can follow.`,
        ]
        return parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from the package preflight.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
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
