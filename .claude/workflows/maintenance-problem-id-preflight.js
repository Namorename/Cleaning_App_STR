export const meta = {
  name: 'maintenance-problem-id-preflight',
  description: 'Short adversarial preflight of 20261008100000_maintenance_problem_id (property_maintenance_tasks gains problem_id) before db push',
  phases: [
    { title: 'Lenses', detail: 'SQL, rights and test; rollout and callers' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\maintenance-problem-id
(branch maintenance-problem-id, from main 0c8afa3). CLAUDE.md states the rules. Work ONLY in this worktree; never
git -C the main tree, never switch branches, never commit, never edit tracked files.

UNDER REVIEW (git diff 0c8afa3..HEAD): supabase/migrations/20261008100000_maintenance_problem_id.sql — drop function
public.property_maintenance_tasks(bigint, integer) and create it again with a ninth column problem_id uuid
(= tasks.problem_id) added LAST; body otherwise word for word from 20260917160000_listing_card_rooms.sql (language
sql, stable, invoker, set search_path = ''); revoke all from public, anon; grant execute to authenticated,
service_role. supabase/tests/property_units.sql — new section «Which report a repair fixes» at the end.
packages/shared/src/database.types.ts — one line. docs/rollout/maintenance-problem-id.md (gate and steps) and
docs/rollout/postpush_maintenance_problem_id.sql (read-only probe). Purpose: the listing card's job row in the panel
cannot see the thread of the report a repair fixes (a repair booked from a report talks in the report's thread).
The panel code that will READ problem_id is NOT in this branch and stays in a branch until the migration is in the
cloud; main's zod schema (apps/web/src/features/apartments/schema.ts, maintenanceTaskSchema, z.object) is meant to
drop the unknown key.

LIVE: cloud head 20261004100000 (= newest file on main); cloud function md5 dae6c32a len 638, ACL
{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}; 9 repairs, all with problem_id.

TOOLS: local stack UP (light) with this migration applied by "supabase migration up --local" (no reset). psql:
docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -v ON_ERROR_STOP=1 (supabase_admin for
set role). ALWAYS begin; ... rollback; — the stack is shared with other work; never db:reset, never migration up/down,
never leave a fixture behind. Local REST: http://127.0.0.1:54321/rest/v1 (keys from "npx supabase status -o json";
never print them). CLOUD read-only, no question: node scripts/cloud-read.mjs --sql "<one select>" (catalog and counts
only, no personal data). FORBIDDEN: db push, db push --dry-run, db query --linked, migration up, any write to the
cloud or Hostaway. MEMORY: at most two agents at once; a single test file at a time, never a full suite.

CALIBRATION: find out whether it is true, not who wins. Report only what you SAW (an experiment or exact lines). An
empty findings list is a fine answer.
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
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
    reason: { type: 'string' },
    better_fix: { type: 'string' },
  },
  required: ['refuted', 'severity', 'reason', 'better_fix'],
}

const LENSES = [
  {
    key: 'sql-rights-test',
    prompt: `LENS: THE FUNCTION, ITS RIGHTS AND THE TEST. (1) Diff the new body against 20260917160000 line by line:
is it really the same apart from the added column (search_path, stable, invoker, order, limit, the room fold)? Any
name clash between the OUT column problem_id and tasks.problem_id inside the SQL body? (2) By experiment in a
rolled-back transaction, using the fixture pattern of supabase/tests/property_units.sql (pg_temp.as_user with
request.jwt.claims): a manager of company A, a manager of company B, a cleaner and a technician call
property_maintenance_tasks on a listing with a repair booked from a report — rows are the same as the old function
would give (RLS, invoker), and problem_id appears exactly where tasks.problem_id is set. Does any role get a
problem_id of a report it cannot select from public.problems — and does that matter (an id, not the text)? (3) Rights
from the catalog: proacl, has_function_privilege for anon / authenticated / service_role, PUBLIC via
aclexplode(coalesce(proacl, acldefault('f', proowner))). Compare with pg_default_acl in the CLOUD (cloud-read) — will
the cloud end with exactly the ACL listed in the post-push probe header? (4) Does the new test section go RED if the
migration is wrong? Mutate inside a rolled-back transaction only (e.g. begin; grant execute on function ... to
public; then run the four rights checks by hand; rollback) — never edit files. (5) pg_depend / grep: does anything
depend on the function (views, other functions, policies, cron, Edge Functions in supabase/functions, scripts,
docs/rollout probes that pin its old md5 or column list)?`,
  },
  {
    key: 'rollout-callers',
    prompt: `LENS: THE ROLLOUT AND THE CALLERS. (1) The gate in docs/rollout/maintenance-problem-id.md: run ONLY
node scripts/cloud-read.mjs docs/rollout/remote_head.sql (read-only) and compare with HEAD_WANT; read the command
text — would a parse failure close the gate; does supabase/.temp in this worktree link the same project as the main
tree (compare files, never print secrets); is the migrations directory of this branch exactly the cloud's plus this
one file (compare with "node scripts/cloud-read.mjs --sql \\"select version from supabase_migrations.schema_migrations
order by 1\\""). DO NOT run db push or its --dry-run. (2) The live panel on main between push and merge: does
fetchMaintenanceTasks (apps/web/src/features/apartments/api.ts) with maintenanceTaskListSchema really accept a ninth
key — prove it by running zod on a sample row with problem_id in node (from apps/web), not by reading. Does any other
reader (apps/mobile, packages/shared, supabase/functions, scripts) call property_maintenance_tasks? (3) drop + create
under PostgREST: on the LOCAL stack, does /rest/v1/rpc/property_maintenance_tasks answer 200 with problem_id (use a
manager JWT made by the local auth admin API inside... or simply the service key — never print it)? What does the
schema-cache reload after DDL mean for a call that lands during the push; is the migration's transaction short (no
locks on tables)? (4) The post-push probe: run docs/rollout/postpush_maintenance_problem_id.sql LOCALLY as
supabase_read_only_user in a read-only transaction (set role) — does every label match its header, and does
scripts/cloud-read.mjs accept the file (run it against the cloud; the 'before' values are expected). (5) Merge
order: after the push, merging this branch into main is a prod panel deploy (types only) — any risk? Will branch
redesign-screens (which has the reader comment in apps/web/src/features/apartments/maintenance-tab.tsx) merge main
later without a conflict in database.types.ts? Check with git merge-tree --write-tree --name-only, read-only.`,
  },
]

const MAX_AGENTS = 2
const MAX_REFUTE_PER_LENS = 4
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

const RANK = { critical: 0, high: 1, medium: 2, low: 3 }

phase('Lenses')

const results = await pipeline(
  LENSES,
  (l) => limited(`${CONTEXT}\n\n${l.prompt}`, { label: `lens:${l.key}`, phase: 'Lenses', schema: FINDING_SCHEMA }),
  (report, l) => {
    if (!report || report.findings.length === 0) {
      return { key: l.key, verified: report ? report.verified : [], confirmed: [], dropped: [], unjudged: [] }
    }
    const sorted = [...report.findings].sort((a, b) => RANK[a.severity] - RANK[b.severity])
    const judgedSet = sorted.slice(0, MAX_REFUTE_PER_LENS)
    const unjudged = sorted.slice(MAX_REFUTE_PER_LENS)
    if (unjudged.length > 0) log(`${l.key}: ${unjudged.length} low-ranked finding(s) not sent to a skeptic`)
    return parallel(
      judgedSet.map((f) => () =>
        limited(
          `${CONTEXT}\n\nFind out whether this finding is TRUE by experiment or by reading the exact lines. If it does not reproduce, or no real caller can reach it, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
          { label: `refute:${l.key}:${f.severity}`, phase: 'Refute', schema: VERDICT_SCHEMA },
        ).then((v) => ({ finding: f, verdict: v })),
      ),
    ).then((judged) => ({
      key: l.key,
      verified: report.verified,
      confirmed: judged.filter(Boolean).filter((j) => !j.verdict || !j.verdict.refuted),
      dropped: judged.filter(Boolean).filter((j) => j.verdict && j.verdict.refuted),
      unjudged,
    }))
  },
)

const out = results.filter(Boolean)
log(`confirmed ${out.flatMap((r) => r.confirmed).length}, dropped ${out.flatMap((r) => r.dropped).length}, unjudged ${out.flatMap((r) => r.unjudged).length}`)
return out
