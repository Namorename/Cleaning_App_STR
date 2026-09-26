export const meta = {
  name: 'window3-preflight',
  description: 'Adversarial preflight of window 3 (properties read narrowing, internal notes table, webhook purge, midstay archive) before it is pushed to the cloud',
  phases: [
    { title: 'Lenses', detail: 'eight independent readings of the six migrations, the panel and the rollout' },
    { title: 'Refute', detail: 'three skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel apps/web +
Expo cleaner app apps/mobile). CLAUDE.md states the rules this repo lives by. The plan of this window,
with the owner's decisions and the rollout recipe, is docs/window3-plan.md — read it first.

BRANCH: window3-properties (NOT main). Its commits on top of main b66e741: bc5a5eb (plan), d83b2df
(six migrations + SQL tests + types), b38b5b7 (panel), 5341bf5 (phone guard/comments), 52d8c81 (docs,
rollout checks). "git diff b66e741..HEAD" is the whole window.

WHAT IS ALREADY IN THE CLOUD: every migration up to and including 20260924120000 (the cloud head). The
production panel (Vercel, deploys every push to main) runs main b66e741. The phones run OTA 543b771 on
build 93919e15; 13b8036 (disk cache read through zod) is in main but not yet shipped.

THE WINDOW (six files, docs/window3-plan.md «Состав окна»):
  * М1 20260924130000_property_internal_notes.sql — table property_internal_notes (manager-only, for
    all policy, host_id default current_host_id(), composite FK to properties(host_id,id)), copy of
    non-empty properties.internal_notes.
  * Б1 20260924140000_staff_property_ids.sql — public.staff_property_ids() setof bigint, security
    definer: the property ids a non-manager may read (linked; assignee of a task in ANY status;
    author of a problem or supply request — on the row or on a room/part right under it; plus the real
    rooms under a linked listing; plus the listing above every tied row). Index tasks(assignee_id,
    property_id) where assignee_id is not null.
  * Б2 20260924150000_properties_staff_read.sql — drops "active staff read properties", creates
    "field staff read their properties": is_active_user() and host_id = current_host_id() and
    id = any (array(select staff_property_ids())). Managers keep "managers write properties" (for all).
  * В 20260924160000_webhook_events_purge.sql — partial index on raw.webhook_events(received_at) for
    processed/skipped; cron job purge-webhook-events '50 3 * * *' deleting processed/skipped > 30 days.
  * Г 20260924170000_archive_cancels_midstay.sql — set_property_status, property_open_cleanings (now
    plpgsql, refuses non-managers with serverErrors.managerOnly), open_cleanings_by_listing: type in
    ('cleaning','midstay').
  * М2 20260924180000_drop_properties_internal_notes.sql — do-block refusing if any non-empty column
    note is not in the table with the same trimmed text, then drop column properties.internal_notes.
  Rollout: db push №1 = М1,Б1,Б2,В,Г (М2 parked out of the directory) -> merge to main (Vercel deploys
  the panel that reads/writes the new table) -> db push №2 = М2. Checks: docs/rollout/window3_probe.sql
  (baseline, counts), docs/rollout/postpush_window3.sql (catalog), docs/rollout/window3_rule_check.sql
  (the deployed function against live rows under each staff member's claims).

THE OWNER'S DECISIONS (approved 2026-09-24, see the plan's «Решения владельца»): no completed_by arm;
the assignee arm has no horizon and no status filter, the author arm includes archived problems — the
accepted price is that a cleaner once given a task on a flat reads it (name, address, cleaner_notes)
for good, and a deactivated one loses everything; the panel writes the note with two requests; archive
cancels midstay but NOT inspection, dialog text unchanged; property_open_cleanings gets is_manager();
the pre-launch archive of the webhook journal covers the last 30 days only; the owner's working rule
is that a manager assigns a cleaner only to a linked property (NOT enforced, deliberately — a post-launch
option); rollout any time except 03:00–03:55 and 04:25–04:40 UTC, owner free about an hour.

LIVE DATA (cloud, counts only, 2026-09-24): 110 properties = 79 listings + 31 rooms, 0 combined-listing
parts, all active; 19 links (9 to deactivated users), 0 to rooms, 0 to technicians; 1 active cleaner,
0 active technicians; 0 internal notes, 0 cleaner notes; 5961 cleanings + 6 repairs, 0 midstay, 0
inspections; completed_by differs from assignee on 2 tasks, both closed by a manager; webhook journal
21 442 processed + 3 265 skipped, oldest 28 days.

TOOLS: the local Supabase stack is UP with the FULL schema of the branch (db:reset applied all six
files) and EMPTY data:
  docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -v ON_ERROR_STOP=1
(pipe SQL on stdin). Seed synthetic rows yourself. To act as a user (see supabase/tests/rls_smoke.sql,
pg_temp.as_user): set local role authenticated; set local request.jwt.claims =
'{"sub":"<uuid>","role":"authenticated"}'. ALWAYS begin; ... rollback; — the stack is SHARED with the
other agents of this run: never commit, never run db:reset or db:types, never create objects outside a
rolled-back transaction. Inside one transaction now() is constant. npm run test:rls is safe (every
suite rolls back). Unit tests: cd apps/web && npx vitest run; cd apps/mobile && npx jest. Do NOT touch
the cloud. Do NOT modify repository files.

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
    key: 'empty-screens',
    prompt: `LENS: EMPTY SCREENS FOR CLEANERS (the lens the owner named). A mistake in this window must not
show up on the day of launch as cleaners' screens losing names, houses or key-box notes — or worse,
failing whole requests. Build a synthetic company on the local stack shaped like production (79
listings, 31 rooms under 9 of them, a few thousand tasks, several cleaners and a technician with
realistic histories: linked listings, stand-in tasks on unlinked listings and rooms, finished,
cancelled and expired tasks, problems and supply requests on rooms, a repair assigned to the
technician, a deactivated cleaner). Then, AS EACH OF THEM, run every select the PHONE sends, exactly as
written in apps/mobile/src/features/**/api.ts (TASK_COLUMNS, PROBLEM_COLUMNS, SUPPLY_COLUMNS,
report_properties, the claim/start/finish UPDATE ... RETURNING with the embed as ONE statement, the
data-modifying CTE at the top level as PostgREST sends it). Report every row where the phone would get a
null property, a null parent for a room, or a null effective_cleaner_notes where the listing above has a
note — and any request that fails outright. Also: does any zod schema of the phone (apps/mobile/src/
features/*/schema.ts, and the ones persisted on disk, read through lib/read-cached.ts) reject what the
narrowed rule returns? Do the installed bundle's schemas (git show 543b771:<path>) accept it too? Is there
any reader the plan's table («Что перестанет работать») misses? For the PANEL: does any manager screen
change (it should not — managers read through is_manager()), including admin role?`,
  },
  {
    key: 'access',
    prompt: `LENS: WHO SEES WHAT. Check the new access surface end to end on the local stack:
  * properties under the new policy for: a linked cleaner, a room-linked cleaner, an assignee-only
    cleaner, a problem author, a supply author, a technician with a repair, a technician without, a
    deactivated user, a manager of the same host, a manager of another host, admin, anon. Include a
    cross-company link and a room of another company hanging under our listing.
  * staff_property_ids() as an RPC (PostgREST exposes public functions): what can a cleaner learn by
    calling it, and can a caller influence whose set it computes (claims, role, search_path)?
  * Recursion or re-entry: the policy calls a definer that reads properties, tasks, problems,
    supply_requests, property_cleaners — any path back into the properties policy under the caller?
  * property_internal_notes: can anyone but a manager of the property's company read, insert, update,
    delete, or upsert into it — including via ON CONFLICT DO UPDATE, via the default host_id, via a
    property of another company, via an inactive manager? Does anything else still expose the note
    (views, functions returning public.properties like set_property_status, PostgREST embeds from
    properties to property_internal_notes as a manager — ambiguous or not)?
  * property_open_cleanings: refused for everyone but a manager; is set_property_status still refused
    for a cleaner with the same key? Any other definer that now leaks what the narrowed policy hides
    (e.g. report_properties, open_cleanings_by_listing as a cleaner)?`,
  },
  {
    key: 'cost',
    prompt: `LENS: COST AND LOCKS. docs/window3-plan.md «Этап 2 — сделано» reports a measurement of three policy
forms (old / set / per-row) on a seed shaped like production and a finding that the phone's task feed
costs ~600 ms for a cleaner with 2340 tasks regardless of this window. Re-measure independently on your
own seed, as a cleaner, with explain (analyze, buffers): the phone's task feed with its embed, the report
picker, a full select of properties, and a manager's registry read (fetchRegistry) and card read. Is the
set built once per statement (InitPlan) and never for a manager? Does the new index get used by
staff_property_ids? Is anything in this window more expensive than before by more than a few ms?
LOCKS: read each of the six files for the locks it takes and in what order, with lock_timeout set first
in every file. The index on tasks (Б1) is in its own file specifically to avoid a deadlock with the
generator (reads properties, then writes tasks). Is there any remaining ordering that can deadlock with
the generator, process-webhook-events, hostaway-webhook inserts, the panel's sync button (sync-listings),
or the phone's writes? Is 3s right given authenticated's 8s statement_timeout?`,
  },
  {
    key: 'order-a',
    prompt: `LENS: THE ORDER OF ITEM А (internal notes). The rollout is М1 (+Б,В,Г) -> panel to main -> М2.
Check each intermediate state:
  * After push №1, BEFORE the panel deploy: the OLD panel (main b66e741, apps/web/src/features/apartments
    at that commit — git show b66e741:<path>) still reads and writes properties.internal_notes. Does it
    still work? Does a note the old panel writes now go anywhere the new panel will read?
  * After the panel deploy, BEFORE М2: the NEW panel (this branch) against a schema that still has the
    column. Does fetchProperty/savePropertyInfo work? Would the generated types (packages/shared/src/
    database.types.ts, generated WITH М2) cause any runtime difference?
  * М2's gate: read the do-block; could it refuse when nothing is lost, or pass when something is lost
    (whitespace, null vs '', a note edited in the new panel, a note deleted in the new panel while the
    column still has it)? The plan says a one-off check was run on the "М1 without М2" state — is the
    reasoning in «Этап 2 — сделано» sound?
  * After М2: a stale tab of the old panel — what does the manager see (the plan says 42703 on read,
    PGRST204 on save)? Is anything else in the repo (Edge Functions, calendar branch f10-stage7-calendar,
    scripts, docs/rollout probes) still naming properties.internal_notes and going to break?
  * The panel code itself (apps/web/src/features/apartments/api.ts, schema.ts, and the new
    __tests__/api.test.ts): correctness of the merge, the order of writes, error handling per CLAUDE.md
    (no raw error.message on screen), and whether the change to the recording client in
    apps/web/src/features/__tests__/postgrest-select.test.ts hides anything it used to catch.`,
  },
  {
    key: 'cron-purge',
    prompt: `LENS: THE WEBHOOK PURGE (item В). Verify on the local stack: the job exists once, schedule, active,
username; its command deletes exactly processed/skipped older than 30 days and nothing else (failed,
pending, fresh). Can it collide with claim_webhook_events / mark_webhook_events / record_webhook_event /
process-webhook-events (row locks, skip locked)? Is the partial index used by the delete? At ~870 rows a
night and ~25k rows total, is there any risk at 03:50 (lock on raw.webhook_events vs hostaway-webhook
inserts)? Is the time 03:50 UTC right against the other six jobs? Read every doc and script that states
the number of cron jobs or the quiet windows (docs/units-plan.md, README.md, docs/ROADMAP.md,
docs/launch-reset.md, docs/rollout/*.sql, .claude/workflows/*.js): anything still saying six where it is
a live rule (not history)? Is docs/launch-reset.md §4/§5 consistent with the owner's decision that the
pre-launch archive covers only the last 30 days?`,
  },
  {
    key: 'midstay-archive',
    prompt: `LENS: ARCHIVING CANCELS MIDSTAY (item Г). Diff the three rewritten functions against their previous
definitions (20260912120000_property_units.sql for set_property_status and property_open_cleanings,
20260917130000_open_cleanings_by_listing.sql): exactly the intended changes, nothing lost (comments,
ACL, grants, security, search_path, volatility — property_open_cleanings moved from SQL to plpgsql)? Do
the three still agree on every case: a listing with rooms, a room alone, a combined-listing part, a
maintenance status, archived, the idempotent repeat press, accepted/in_progress midstay, inspection and
maintenance untouched? Does the panel's status dialog (apps/web/src/features/apartments/status-dialog.tsx,
maintenance-tab.tsx, registry openCleaningsOf) still show the right numbers, and does anything in the
panel call property_open_cleanings in a way the new manager check breaks? Does anything else in the
schema filter type = 'cleaning' where archiving now should include midstay (the plan lists the generator
and expired_tasks_review as out of scope — argue only if something is wrong for the owner's decision)?`,
  },
  {
    key: 'tests-and-rules',
    prompt: `LENS: TESTS AND HOUSE RULES. Run npm run test:rls, cd apps/web && npx vitest run && npx tsc --noEmit -p .,
cd apps/mobile && npx jest && npx tsc --noEmit. Then read the tests of this window
(supabase/tests/rls_smoke.sql window-3 section, property_internal_notes.sql, webhook_retention.sql, the
midstay parts of property_units.sql and property_status.sql, apps/web/src/features/apartments/
__tests__/api.test.ts): do they test what they claim (would each fail if the thing broke — try a few
mutations in a rolled-back transaction), and do they cover the owner's required cases (not linked 0;
linked listing + rooms; manual task assignee; problem author; technician repair; finished history)?
Check the repo rules in CLAUDE.md against the diff: English in code/comments/errors (rls_smoke.sql was
translated — anything left?), hint carries i18n keys only, every new table in the table_grants.sql
matrix with revoke all + explicit grant, READERS of both apps list every reader, new cron/table/function
documented, no console.log, prettier style of the changed lines (npx prettier --single-quote
--print-width 100 --trailing-comma all --check, only lines this window changed count).`,
  },
  {
    key: 'rollout-procedure',
    prompt: `LENS: THE ROLLOUT PROCEDURE (docs/window3-plan.md «Порядок выката», «Время»; docs/units-plan.md and
docs/chat-plan.md «Эксплуатация выката»; CLAUDE.md on db push by an agent). Walk it step by step as the
person who will run it: the guard command (HEAD_WANT/LIST_WANT exact strings, dry-run output format),
parking М2 with sha256 and returning it, what happens if push №1 stops after М1 or after Б1 (Б1 without
Б2 — is that state safe?), the merge to main and Vercel, the OTA rule (migration list before eas update;
M2 in main but not in the cloud), push №2, the rollback migration text in postpush_window3.sql (drops the
new policy too; numbering; test revert). Run docs/rollout/postpush_window3.sql and
docs/rollout/window3_rule_check.sql against the LOCAL stack with npx supabase db query -f <file> (no
--linked!) — each must be ONE statement and parse; on seeded data inside a transaction (psql), does
window3_rule_check.sql really evaluate the function per person (seed two people with different sets)?
Is window3_probe.sql still valid after М2? Is anything in the procedure impossible or ambiguous for the
person running it, or does it depend on something not written down?`,
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
          `Accept that the finding is real and attack the FIX instead. Does the proposed fix close it without opening something else, without breaking a house rule (CLAUDE.md), and without adding a second place where a rule is written? Would it change something already in the cloud? If the fix is wrong, give the better one. Refute only if the fix would make things worse or the severity is overstated by more than one level.`,
          `Check the finding against the PLAN (docs/window3-plan.md) and the owner's stated decisions (no completed_by arm; no horizon and archived problems included, with the accepted price; two requests for the note; inspection not cancelled; property_open_cleanings manager-only; 30-day archive; assignment to linked properties NOT enforced in this window; the rollout order and quiet windows). If the finding is really a disagreement with an approved decision, refute it and say which decision it argues with.`,
        ]
        return parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from the preflight of window 3.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
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
