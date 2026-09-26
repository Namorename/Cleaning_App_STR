export const meta = {
  name: 'window3-fixes-preflight',
  description: 'Adversarial preflight of the window 3 ultrareview fixes (cloud read guard, Hostaway path, panel cache) — the lenses these fixes touch',
  phases: [
    { title: 'Lenses', detail: 'four readings of commit 48f3055: read guard, panel cache, tests and rules, the rollout reads' },
    { title: 'Refute', detail: 'three skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel apps/web +
Expo cleaner app apps/mobile). CLAUDE.md states the rules this repo lives by; its paragraph on reading the
cloud («Чтение облака») describes the tools under review.

BRANCH: window3-properties (NOT main). Window 3 itself (seven migrations, panel, docs) was preflighted by
.claude/workflows/window3-preflight.js (run wf_855b41ca-cc7) and is NOT under review here. Under review is
ONE commit, 48f3055 ("fix(tools): находки ultrareview окна 3"): "git show 48f3055" is the whole change. It
answers the four findings of the cloud ultrareview in docs/window3-ultrareview.md:
  1. scripts/cloud-read.mjs — the side-effect guard was a set of regexes on the comment-stripped text,
     bypassed by SET search_path + a bare call, quoted identifiers, or a '--' inside a string. Now
     refusal() lexes the query like the server (comments, '' / E'' / $tag$ literals set aside, quoted
     identifiers unquoted, U& refused, unterminated anything refused), requires every statement to be a
     read (select/with/explain/show/table/values/'('), refuses side-effect and SQL-from-string functions by
     bare name, and allows set_config only for request.jwt.claims. The file runs main() only when started
     as a script (import.meta.url vs pathToFileURL(process.argv[1])) so the tests can import refusal().
  2. scripts/hostaway-get.mjs — the traversal guard only refused a literal '..'; fetch() collapses %2e%2e.
     Now apiUrl(base, path) refuses scheme/host/'..'/backslash/%2e/%2f/%5c and checks the URL fetch() will
     use still lies under the API root. Same run-as-script guard.
  3. apps/web/src/features/apartments/use-apartments.ts — useSaveInfo (two writes: properties row, then
     property_internal_notes) and useSyncListings now invalidate the cache on settle, not only on success.
  4. The duplicated baseUrl()/tokenFile() in hostaway-get.mjs and hostaway-issue-token.mjs are KEPT, on
     purpose: .claude/hooks/script-pins.mjs hashes the pinned script before every no-question run, and a
     shared module would change what runs without changing that hash. A test keeps the copies equal.
  Pins in .claude/hooks/script-pins.json were updated; npm run test:scripts runs node --test on
  scripts/__tests__/*.test.mjs.

WHY THE GUARD MATTERS: the permission rules let an agent run "node scripts/cloud-read.mjs *" and
"node scripts/hostaway-get.mjs *" WITHOUT asking the owner. The endpoint runs the query as
supabase_read_only_user in a read-only transaction, but PUBLIC may still execute a few C functions with
side effects (cron.schedule/unschedule, pg_net's worker_restart/wake, large objects). Revoking those in
the database is F13 — a separate migration with its own preflight, deliberately NOT part of window 3.
Until then refusal() is what stops them.

TOOLS: the local Supabase stack is UP with the branch schema (db:reset done this morning) and EMPTY data:
  docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
(pipe SQL on stdin; supabase_admin can SET ROLE supabase_read_only_user if that role exists locally). ALWAYS
begin; ... rollback; — never commit, never run db:reset or db:types. Import refusal()/apiUrl() with node
(node --input-type=module -e "import { refusal } from './scripts/cloud-read.mjs'; ...") — importing sends
nothing. NEVER send a query to the cloud and NEVER call Hostaway: to see what a run of the script does, run
it only with an input it must refuse. Do NOT modify repository files; experiment on copies in your own
scratch directory.

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
          how_seen: { type: 'string', description: 'The experiment or reading that shows it: the exact input you ran and what came back.' },
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
    key: 'read-guard',
    prompt: `LENS: THE READ GUARD AND THE HOSTAWAY PATH. Attack refusal() in scripts/cloud-read.mjs: find query text it
returns null for that, run on the read-only endpoint (supabase_read_only_user, read-only transaction,
several statements in one call), would write anything, schedule anything, send anything over the network,
notify anyone, or lift the read-only mode. Try lexer confusions (nested comments, dollar tags, E-strings
ending in a backslash, U& in odd places, identifiers containing $ or quotes or semicolons, string
continuation across a newline, '--' or '/*' glued to operators, a comment opener inside a dollar string),
statement splitting, implicit calls (casts, operators, domain checks, table functions), other names for
the same functions (overloads, pg_catalog wrappers, whatever extensions supabase/migrations and the local
catalog show as installed), EXPLAIN ANALYZE, SELECT INTO, FOR UPDATE. On the LOCAL stack enumerate every
function that PUBLIC — and supabase_read_only_user, if the role exists locally — may execute and that is
not read-only in effect (writes a catalog or table row, signals, sends, schedules); check each against
refusal(). Also attack apiUrl() in scripts/hostaway-get.mjs: any path it accepts that leaves /v1 at
Hostaway under WHATWG URL semantics (tabs and newlines the parser strips, %00, double encoding like
%252e, ?/# tricks, IDNA). And the run-as-script guard at the bottom of both files: do "node
scripts/cloud-read.mjs", "node ./scripts/cloud-read.mjs", "node scripts\\cloud-read.mjs", a different
letter case of the path, and a path through a junction all actually run main()? Run each spelling ONLY
with a query it must refuse (--sql "select cron.schedule(1)"): a working run prints "refused" and exits 1;
a silent exit 0 is the defect. Last: do the pins in .claude/hooks/script-pins.json equal
"git show HEAD:<path> | sha256sum" and the sha256 of the working files?`,
  },
  {
    key: 'panel-cache',
    prompt: `LENS: THE PANEL CACHE CHANGE. useSaveInfo and useSyncListings (apps/web/src/features/apartments/
use-apartments.ts) now invalidate on settle. After a failed save, is anything the manager typed lost —
info-tab.tsx seeds its draft with a useState initializer; does any parent (property-card.tsx,
apartments-view.tsx, the route) remount InfoTab or unmount it behind a loading state on refetch? Does the
error text stay on screen after the refetch? Does a failed sync cause a refetch storm or a flicker? Does
anything rely on onSuccess semantics (toasts, closing a dialog)? Are useSetStatus, useSaveChecklist and
useCopyChecklist right to stay on onSuccess — does any of them write in more than one transaction? Is the
same two-writes-in-one-mutation pattern anywhere else in the panel, where ultrareview's reasoning would
apply too? Run cd apps/web && npx vitest run src/features/apartments.`,
  },
  {
    key: 'tests-and-rules',
    prompt: `LENS: TESTS AND HOUSE RULES FOR THIS COMMIT. Run npm run test:scripts, and cd apps/web && npx vitest run
src/features/apartments && npx tsc --noEmit -p . Then check that the new tests test what they claim:
mutate COPIES of the code (copy scripts/ with its __tests__ to your scratch dir, keeping relative paths;
never edit the repo) — drop the bare-name matching, the statement whitelist, the E-string branch, the
dollar-quote branch, the claims allowlist, the %2e check, the pathname check, the unterminated checks —
and run node --test on the copy; for the panel, reason from the test whether onSuccess would turn it red
(it was red before the fix: the author saw 0 calls). Report every mutation no test catches. House rules
(CLAUDE.md) on the diff: English in code, comments and errors; no console.log; the style of the changed
lines (npx prettier --single-quote --print-width 100 --trailing-comma all --check on the changed files —
report only lines this commit changed); "npm run test:scripts" works on Windows (glob quoting); and any
text in CLAUDE.md, README.md or docs/ that describes these tools and is now untrue (e.g. a layer called
REFUSED that is now refusal()).`,
  },
  {
    key: 'rollout-reads',
    prompt: `LENS: THE ROLLOUT'S READS. docs/window3-plan.md «Порядок выката» and CLAUDE.md (the db push guard) run
read-only checks against the cloud: docs/rollout/remote_head.sql, window3_probe.sql,
postpush_window3.sql, window3_rule_check.sql. The plan was written before scripts/cloud-read.mjs existed
and runs them with "npx supabase db query --linked -f" (the owner's word each time). Work out, on the LOCAL
stack as supabase_read_only_user if the role exists locally (begin; set local role ...; rollback;), which
of them can run through cloud-read.mjs — the grants each needs: supabase_migrations.schema_migrations,
cron.job, properties, property_internal_notes, staff_property_ids(), set_config of request.jwt.claims —
and which must stay on db query --linked. Confirm the test "passes every rollout check in docs/rollout"
is not vacuous (it reads the files it names). Is any step of the procedure now ambiguous because two
tools exist, or would the person running it pick the tool that fails? Do NOT send anything to the cloud.
Report as findings only what would make a rollout step fail or mislead the person running it.`,
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
          `Try to REFUTE this finding by experiment. Reproduce it exactly as described in how_seen (locally; never against the cloud or Hostaway). If it does not reproduce, refute. If it reproduces but no real caller can reach it (the permission rules, the pin hook, the read-only role and transaction all stand in the way), refute it as unreachable and say which layer stops it.`,
          `Accept that the finding is real and attack the FIX instead. Does the proposed fix close it without opening something else, without breaking a house rule (CLAUDE.md), without refusing a read the rollout needs (docs/rollout/*.sql), and without weakening the pin (a pinned script must stay self-contained)? If the fix is wrong, give the better one. Refute only if the fix would make things worse or the severity is overstated by more than one level.`,
          `Check the finding against SCOPE and the owner's decisions: the guard is a second layer until F13 revokes the functions in the database (F13 is a separate migration, NOT part of window 3); the duplicated Hostaway helpers are kept on purpose for the pin; window 3 must roll out today because a deactivated account can make itself a manager in production. If the finding argues with one of these, or belongs to F13 rather than to this commit, refute it and say which.`,
        ]
        return parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from the preflight of commit 48f3055.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
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
