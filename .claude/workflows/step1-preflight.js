export const meta = {
  name: 'step1-preflight',
  description: 'Adversarial preflight of step 1 (open problems): the three-migration package before db push, plus the panel and maid-app fixes before they ship',
  phases: [
    { title: 'Lenses', detail: 'six readings of the migration package, three of the app changes' },
    { title: 'Refute', detail: 'two skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel apps/web +
Expo cleaner app apps/mobile). CLAUDE.md states the rules this repo lives by. docs/ROADMAP.md, «Минимум
запуска», item 1 «Открытые проблемы», lists what step 1 closes and the owner's decisions; the approved
problem list (numbers 7–27 below) comes from the review of 2026-09-25.

WHAT IS UNDER REVIEW: the UNCOMMITTED working tree on main (HEAD 8b1338e). "git diff" plus the untracked
files ("git status --short") are the whole of step 1. Do NOT modify any repository file, do NOT run git
commands that change state, do NOT touch the cloud except the read-only reads allowed below.

WHAT IS LIVE: cloud head 20260924180000 (every migration up to it). The production panel (Vercel, deploys
every push to main) runs main 8b1338e. The phones run build 1.0.0 (APK of 17.09) with OTA 0e335479;
runtimeVersion = version, so an OTA from main reaches them only while app.json keeps version 1.0.0.

THE PACKAGE (one preflight, one db push, stop before the push for the owner's word):
  * 20260926100000_grants_hygiene.sql — (7) revoke sequence defaults from anon/authenticated in public and
    revoke all on existing public sequences; (8) a do-block over pg_proc in public (extension members
    skipped): explicit anon EXECUTE revoked; where PUBLIC could execute, an explicit grant to
    authenticated, service_role (non-trigger functions) and then revoke from PUBLIC. Defaults: a GLOBAL
    "alter default privileges for role postgres revoke execute on functions from public" (a per-schema
    entry cannot remove the built-in PUBLIC grant — verified on the local stack), plus per-schema
    revoke from anon and grant to authenticated, service_role in public. Consequence already seen: every
    function postgres creates in ANY schema, pg_temp included, is owner-only until granted; 22 SQL test
    suites got a transaction-local "alter default privileges for role postgres grant execute on
    functions to authenticated" after begin so their pg_temp helpers still run as authenticated.
  * 20260926101000_media_rpc_one_owner.sql — (10) add_task_media / add_problem_media / add_message_media:
    a replayed id is returned only when (v_media.<owner>_id = p_<owner>_id) is not false-or-null and the
    author is the caller; otherwise serverErrors.mediaNotFound. Bodies otherwise those of 20260918170000
    and 20260924120000.
  * 20260926102000_generator_service_bookings.sql — (12, owner's decision 2026-09-25) a booking whose
    guest name starts with "#" after leading white space is a block: public.is_service_booking(text)
    immutable; generate_cleaning_tasks (_wanted) and reservation_cleaning_window (arriving guest) treat
    it like is_block; the generator's idempotency comment corrected. is_block and the Edge Functions are
    untouched on purpose.
  (9) is a test only: generate_cleaning_tasks EXECUTE — authenticated false, anon false, service_role
  true (supabase/tests/tenant_isolation.sql). docs/rollout/postpush_step1.sql is the post-push check
  (to be run with node scripts/cloud-read.mjs); its md5 values are recomputed by the main agent after the
  last db:reset, so a stale md5 there is NOT a finding.

THE APP CHANGES (no schema; the panel goes to main = production, the phone goes by one OTA on 1.0.0):
  * panel: (11) inspection and maintenance cannot be saved without an assignee — the form only, owner's
    decision, no migration; (21) useSaveStaff invalidates on settle; (22) search folds case and
    diacritics (apps/web/src/lib/search.ts foldForSearch / matchesAllTokens) in tasks, registry,
    problems, team and the property picker; (23) dead ui/select.tsx, ui/dropdown-menu.tsx and eight
    locale keys removed.
  * phone: (13) flaky tests (jest.setup.ts warm-up, testTimeout, maxWorkers, language-gate isolation);
    (14) Alerts of "Взять" and sign-out go through serverErrorText, raw text as a second paragraph
    (sign-out-button.tsx, RefusalError, alertMessage); (15) "Заезда нет" not claimed for maintenance or
    for a task without a booking (reservation_id added to the task select, optional in the zod schema);
    (16) a free task opens before "Взять" (claim button moved out of the pressable card); (17) job words
    follow the kind (tasks.work.* keys), server error texts neutral, Czech tab "Moje úkoly"; (18) the root
    error screen can "reset saved lists" — drops persisted queries, keeps the offline mutation queue, no
    buster bump; (19) three expo lint errors fixed (setState in effect → set during render,
    useSyncExternalStore); (20) Expo template leftovers and global.css removed, env.ts error in English.
  * docs: npm script db:push removed; role_table_grants checks replaced by pg_class.relacl; ROADMAP
    «Минимум запуска» rebuilt to the owner's order (problems → calendar → F11 → dashboard → redesign, F11
    build is a test build for the owner's phone only, maids get one APK after the redesign); stale
    places in ROADMAP, README, f10-plan, chat-plan, launch-reset, CLAUDE.md; eas.json development profile
    removed.

TOOLS: the local Supabase stack is UP with the full schema of the working tree and EMPTY data:
  docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -v ON_ERROR_STOP=1
(pipe SQL on stdin). Seed synthetic rows yourself. To act as a user (see supabase/tests/rls_smoke.sql,
pg_temp.as_user): set local role authenticated; set local request.jwt.claims =
'{"sub":"<uuid>","role":"authenticated"}'. ALWAYS begin; ... rollback; — the stack is SHARED with the
other agents of this run: never commit, never run db:reset or db:types, never create objects outside a
rolled-back transaction. Inside one transaction now() is constant. Remember that after this package a
pg_temp function you create is owner-only: grant it inside your transaction if you call it as
authenticated. npm run test:rls is safe (every suite rolls back) but slow — prefer single suites via psql.
CLOUD, READ-ONLY, NO QUESTION NEEDED: node scripts/cloud-read.mjs --sql "<one select>" (role
supabase_read_only_user, read-only transaction). Catalog reads and COUNTS only; never print guest names,
e-mails, phones or any other personal data — aggregate them away inside the query.
MEMORY: the machine has 16 GB and a crash from too many processes happened on 2026-09-25. Do NOT run the
full jest or vitest suites (the main agent ran them: all green); run at most one single test file at a
time, jest with --maxWorkers=2. Never leave a background process.

CALIBRATION (project memory "adversarial-refuters-calibration"): skeptics have reflexively refuted real
findings before, and lenses have padded reports with non-defects. Report only what you have SEEN — by an
experiment or by reading the exact lines — and say which. An empty findings list is a fine answer.
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
          how_seen: { type: 'string', description: 'The experiment or reading that shows it. Name the SQL or command you ran and what came back; do not paste large output.' },
          fix: { type: 'string', description: 'The smallest change that closes it.' },
        },
        required: ['title', 'severity', 'where', 'what', 'how_seen', 'fix'],
      },
    },
    measurements: {
      type: 'array',
      description: 'Numbers you actually measured, one line each. Empty if this lens measured nothing.',
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
    key: 'grants-cloud',
    prompt: `LENS: WHAT 20260926100000 DOES IN THE CLOUD, NOT ON THE LOCAL STACK. Hosted Supabase hands out default
privileges differently (CLAUDE.md). Read the cloud catalog with cloud-read.mjs and predict the migration's
exact effect there:
  * every function in public: owner, proacl (null = built-in PUBLIC), trigger or not, extension member or
    not — does the do-block's classification hold for each, and is any cloud function absent locally?
  * pg_default_acl for every role (postgres, supabase_admin, others) in public and globally: what does a
    function, sequence and table created by postgres get after the migration, per schema?
  * sequences in public in the cloud (count, owners) and who holds what on them now.
  * THE GLOBAL REVOKE: which schemas does postgres create functions in, today and in plausible future
    migrations (raw, extensions via "create extension", storage, auth hooks)? In the cloud, who owns the
    functions of extensions created so far (supautils may create them as another role)? Would a future
    "create extension" by postgres give functions nobody but postgres may execute — and would that break a
    client path silently or loudly? Compare with the alternative: no global revoke, the per-schema grant
    only, and the table_grants.sql test "no function of ours in public is executable by anon" as the
    guard (it runs on every db:reset before a push). Recommend one, with the concrete risk of each.
  * does anything the read-only role runs (scripts/cloud-read.mjs, its refusal() guard, every
    docs/rollout/*.sql) call a function that loses PUBLIC? The pinned comment in cloud-read.mjs:46-50
    will go stale — say whether that matters.`,
  },
  {
    key: 'grants-callers',
    prompt: `LENS: WHO CALLS THE SIXTEEN FUNCTIONS, AS WHOM. After 20260926100000 anon and PUBLIC lose EXECUTE on
is_manager, auth_role, is_active_user, short_cleaning_threshold and twelve trigger functions (list them
from pg_proc). By experiment on the local stack, each in a rolled-back transaction, as the role that
really does it: every RLS policy that calls them (tables and storage.objects), the view report_properties
(security_invoker), the generated column tasks.is_short_measurement (insert and update of tasks as
authenticated via the RPCs the apps use, and as service_role — the generator), every trigger (fire each:
auth.users insert/update as supabase_auth_admin, profiles, tasks transitions, task_steps, problems,
chat, supply requests), PostgREST's own introspection, pg_cron jobs (run as postgres), Edge Functions
(service_role), Realtime if any publication exists. Also: supabase_storage_admin evaluating storage
policies, authenticator. Anything that now gets "permission denied for function" is a critical finding.
Also check that no function in public is still executable by anon afterwards (has_function_privilege for
every one), and that the do-block is idempotent and safe if re-run.`,
  },
  {
    key: 'media-rpc',
    prompt: `LENS: THE THREE MEDIA RPCs (20260926101000). Diff each body against its previous definition
(20260918170000_media_rpc_race.sql for add_task_media and add_problem_media, 20260924120000 for
add_message_media — confirm those are the latest, grep later migrations): exactly the owner/author lines
changed, nothing else (locks, the late re-read after the lock, limits, paths, grants, comments). Then by
experiment: every replay combination — same id with the same owner (must return the row), another owner
of each kind, null owner, another author, another company — and the race: two sessions registering the
same id concurrently for different owners. Then the PHONE: how does its offline queue treat
serverErrors.mediaNotFound on a replay (apps/mobile/src/features/**/media*, upload queue, the mutation
defaults in lib/query-client.ts)? Could a legitimate replay after lost connectivity now be refused (e.g.
a step photo replayed after the step row was re-snapshotted, a message photo whose message id the phone
re-created)? Could a refusal loop forever or drop a photo silently?`,
  },
  {
    key: 'generator',
    prompt: `LENS: SERVICE BOOKINGS IN THE GENERATOR (20260926102000). Diff generate_cleaning_tasks and
reservation_cleaning_window against their latest previous definitions (grep all migrations; the header
names 20260923120000 and 20260912150000): only the is_service_booking lines and the comment changed?
Is there any OTHER place where is_block changes what cleanings exist or when (expire_stale_tasks /
the sweeper, the midstay path, set_property_status, open_cleanings_by_listing, archive, reservation
units / rooms, sync_hostaway_reservations, the webhook processor, the phone's and the panel's readers
of "arriving guest" — e.g. the "Заезда" plate, the panel's task card, the calendar branch
f10-stage7-calendar)? A booking is a block there but not a service booking would be an inconsistency.
By experiment: renamed live booking with a cleaning in each status (new/assigned/accepted/in_progress/
done/expired/cancelled) — what happens on the next run, and is that the same as for is_block? A service
booking on a room of a multi-unit listing (reservation_units). A name like "#" alone, " #", "\\u00a0#",
"Guest #2", null, "＃" (full-width). CLOUD, counts only: how many live bookings (departure today or later,
not cancelled) have a guest name that is_service_booking would match, and how many open cleanings the
first run after the push would therefore cancel — the owner must know this number before "пушим".
Also measure the generator's cost by calling it (generic plan) on a seed shaped like production, before
and after.`,
  },
  {
    key: 'db-tests',
    prompt: `LENS: THE SQL TESTS AND THE HOUSE RULES OF THE PACKAGE. Read the new and changed tests
(supabase/tests/table_grants.sql, task_media.sql, chat.sql, task_generation.sql, tenant_isolation.sql
and the 22 suites that got the transaction-local default-privilege line). Would each new test fail if the
thing it guards broke? Try mutations in a rolled-back transaction (re-create an old function body, grant
EXECUTE to anon, restore the PUBLIC default) and run the relevant suite through psql to see it go red.
Does the transaction-local line in the 22 suites weaken anything those suites check (e.g. a suite that
tests function privileges now passing because of it)? Is the line really rolled back with the
transaction (alter default privileges is transactional?) — prove it. House rules (CLAUDE.md): English in
code, comments and errors; hint carries i18n keys only; table_grants.sql matrix; database.types.ts
regenerated (one line added, is_service_booking); the migration files are self-contained and would apply
cleanly on the CLOUD's current state (not only after a local db:reset).`,
  },
  {
    key: 'rollout',
    prompt: `LENS: THE ROLLOUT OF THE PACKAGE. Walk it as the person who runs it: the guard command from
docs/units-plan.md «Эксплуатация выката» (HEAD_WANT=20260924180000, LIST_WANT = the three file names in
order), the dry-run output format, db push, then node scripts/cloud-read.mjs docs/rollout/postpush_step1.sql.
Run postpush_step1.sql against the LOCAL stack as supabase_read_only_user (the way cloud-read does:
read-only transaction) — one statement, parses, every label as documented, and does refusal() in
scripts/cloud-read.mjs accept it? Locks: which locks do the three files take (grant/revoke on functions
called by every RLS query, create or replace of the generator while process-webhook-events calls it every
two minutes)? Is lock_timeout set, and is it right against authenticated's statement_timeout? Must cron be
paused (docs/units-plan.md: not for a create or replace)? Quiet windows (not 03:00–03:55 or 04:25–04:40
UTC). What if the push stops after the first or second file — is each intermediate state safe for the
live panel and phones? Is there a rollback text, and does it restore PUBLIC defaults and grants
correctly? Does anything in the app changes need the package in the cloud first (CLAUDE.md: client code
that reads unshipped schema must not reach main/OTA)? Check postpush_step1.sql expectations against the
local catalog EXCEPT md5 (recomputed later).`,
  },
  {
    key: 'panel',
    prompt: `LENS: THE PANEL CHANGES (apps/web). Read the diff of apps/web and the shared locales. (11) the
task form: can an inspection or maintenance still be saved without an assignee by any path — keyboard
submit, the duplicate-confirm path, editing an existing task, switching the kind after choosing nobody,
a task created from a problem (maintenance) — and is a cleaning/midstay without assignee still allowed?
Does a disabled "nobody" option confuse a screen reader, and is the error announced (aria-invalid,
describedby)? (21) the hook test really proves invalidation on error. (22) foldForSearch: correctness for
Czech (all háček/čárka letters, ů), Russian ё/е and й, German ß, Turkish I, already-decomposed input,
and that every search box of the panel now uses it (grep for toLowerCase().includes and
toLocaleLowerCase in apps/web/src). (23) nothing still imports the deleted files; the eight removed keys
are unused (dynamic keys included) and the phone does not use them. Run single test files only.
House rules: no raw error.message on screen, English in code, i18n keys in three languages, READERS
of postgrest-select.test.ts untouched or updated if a select changed.`,
  },
  {
    key: 'phone',
    prompt: `LENS: THE PHONE CHANGES (apps/mobile) — they ship by OTA to installed build 1.0.0, so a mistake
reaches every phone at once. Read the diff of apps/mobile and the shared locales. Check:
  * OTA safety: no native change (app.json, plugins, permissions, native dependencies, assets referenced
    by app.json); nothing imports a module the 1.0.0 binary lacks; the deleted global.css / css.d.ts /
    style-mock and images are referenced nowhere (web output "static" included).
  * the persisted query cache (lib/read-cached.ts, query-client.ts): the task select gained
    reservation_id — does a cache written by the OLD bundle still parse (optional field), does the new
    bundle behave correctly on such rows, and was buster left alone? (18) forgetSavedQueries: does it keep
    the offline mutation queue exactly, survive a crash loop, and really re-create the QueryClient on
    retry (read expo-router's ErrorBoundary/Try code in node_modules to confirm)?
  * (14) RefusalError / alertMessage / moveTask: every path that used to show a translated text still
    shows the right one (claim race "claimTaken", start too early, parallel start off, finish blocked by
    a step), nothing shows raw error.message, and server texts appear only as the second paragraph.
  * (15)–(17): urgencyText and jobWordKey for all four kinds with and without a booking; words on the
    task screen, step list and cards; the claim button now outside the pressable card — touch target,
    accessibility role/label, and that pressing it does not also open the task.
  * (13): jest.setup warm-up and timeouts do not hide a real failure (a test that never awaits now
    passing?), language-gate isolation.
  * (19): set-state-during-render in problem/[id]/edit.tsx and supply/new.tsx cannot loop and does not
    overwrite what the user typed when the query refetches.
Run single test files only (jest --maxWorkers=2).`,
  },
  {
    key: 'words-and-docs',
    prompt: `LENS: WORDS AND DOCUMENTS. (a) The three locale files packages/shared/src/i18n/locales/{ru,en,cs}.json:
diff them; for every changed or added key, is the text right in all three languages for EVERY kind of job
it can be shown on (cleaning, midstay, inspection, maintenance), natural for a cleaner, and consistent in
terms with the rest of the file? The Czech wording was invented by an agent — flag anything a native
speaker would find wrong or odd, with a better phrasing. Server error keys (serverErrors.*) must not name
"уборка" when the error can come from an inspection or a repair. (b) The documents: docs/ROADMAP.md
«Минимум запуска» against the owner's order and decisions of 2026-09-25 (problems → calendar → F11 →
dashboard → redesign; F11 build is a test build for the owner's phone only; maids get the APK once, after
the redesign; passwords decision; service bookings by "#"; expo lint is fixed) — any contradiction,
stale step number (п.2а, п.7 and the like), arithmetic error in the estimates table, or claim that the
repository does not support? README.md, CLAUDE.md, docs/f10-plan.md, docs/chat-plan.md,
docs/launch-reset.md changes: correct and consistent? Nothing may still tell a reader to run
"npm run db:push" or to check grants through information_schema.role_table_grants as a live rule.`,
  },
]

phase('Lenses')

const ANGLES = [
  `Try to REFUTE this finding by experiment or by reading the exact lines. Reproduce it as described in how_seen. If it does not reproduce, say so and refute. If it reproduces but no real caller can reach it (no policy, no RPC, no app path, no screen), refute it as unreachable and say why.`,
  `Accept that the finding is real and judge SEVERITY and FIX against the approved plan: docs/ROADMAP.md «Минимум запуска» item 1 and the owner's decisions (service bookings by "#" treated as blocks; inspection/maintenance assignee enforced in the panel form only, no migration; expo lint fixed; one db push with a stop before it; the phone by OTA on 1.0.0). Refute if it argues with an approved decision, or if the severity is overstated by more than one level. If the proposed fix is wrong or opens something else, give the better one.`,
]

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
      report.findings.map((f) => () =>
        parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from the preflight of step 1.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
              { label: `refute:${l.key}:${f.severity}:${i + 1}`, phase: 'Refute', schema: VERDICT_SCHEMA },
            ),
          ),
        ).then((votes) => {
          const live = votes.filter(Boolean)
          const against = live.filter((v) => v.refuted).length
          return { finding: f, refutedBy: against, survives: against < live.length || live.length === 0, verdicts: live }
        }),
      ),
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
