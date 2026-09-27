export const meta = {
  name: 'service-booking-field-preflight',
  description: 'Short adversarial preflight of 20260926140000_service_booking_field (the "#" flag as a PostgREST computed field) before db push',
  phases: [
    { title: 'Lenses', detail: 'SQL and exposure; rollout' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar
(branch f10-stage7-calendar). CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree.

UNDER REVIEW: commit 5922978 — supabase/migrations/20260926140000_service_booking_field.sql (a new overload
public.is_service_booking(booking public.reservations) returns boolean, immutable, set search_path = '', body
"select public.is_service_booking(booking.guest_name)", explicit revoke from public, anon and grant to
authenticated, service_role), supabase/tests/service_booking_field.sql, packages/shared/src/database.types.ts,
docs/rollout/postpush_service_booking_field.sql. Owner's decision 2026-09-26 (docs/f10-plan.md §2, option a):
the calendar reads the "#" flag as a computed field with each booking, so the rule stays one function. The
panel code that selects the field will live only in this branch until the migration is in the cloud.

LIVE: cloud head 20260926102000 (step 1 pushed 26.09: grants hygiene — PUBLIC has no EXECUTE on functions of
ours, global default revokes it for functions postgres creates, per-schema default grants authenticated and
service_role in public; is_service_booking(text) exists). main = d8883af does NOT contain this migration.

TOOLS: local stack UP with this migration applied (migration up, no reset). psql: docker exec -i
supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -v ON_ERROR_STOP=1 (supabase_admin for set role).
ALWAYS begin; ... rollback; — the stack is shared; never db:reset. Local REST: http://127.0.0.1:54321/rest/v1
(keys from "npx supabase status -o json"; never print them). CLOUD read-only, no question: node
scripts/cloud-read.mjs --sql "<one select>" (catalog and counts only, no personal data). Never db push, never
db query --linked. MEMORY: at most two agents at once; single test files only.

CALIBRATION: report only what you SAW (experiment or exact lines). An empty findings list is a fine answer.
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
    reason: { type: 'string' },
    better_fix: { type: 'string' },
  },
  required: ['refuted', 'reason', 'better_fix'],
}

const LENSES = [
  {
    key: 'sql-exposure',
    prompt: `LENS: THE FUNCTION AND HOW IT IS SEEN. (1) By experiment: as authenticated with a manager's claims
(pg_temp.as_user pattern of supabase/tests/rls_smoke.sql) in a rolled-back transaction with seeded host,
property and reservations, select r.id, public.is_service_booking(r) from public.reservations r — the answer
equals the text rule for "#x", " #x", NBSP+"#", "Guest #2", null; RLS still filters the rows as before; a
cleaner sees the flag only on rows RLS gives her. (2) PostgREST: the local REST answers
select=id,is_service_booking on reservations with 200 (and an embed from another table, e.g.
tasks?select=id,reservation:reservation_id(is_service_booking) — does it work or is it ambiguous?). (3) The
overload: grep every caller of is_service_booking in supabase/, apps/, packages/, docs/rollout/ and
.claude/workflows — does any call become ambiguous or pick the other overload (a null literal, a record, a
cast)? (4) CLOUD catalog: will the cloud give the new function exactly {postgres, authenticated,
service_role}? Read pg_default_acl for postgres (global and public) there. (5) database.types.ts: what the
regenerated Functions entry looks like and whether tsc of apps/web still passes (run npx tsc --noEmit in
apps/web — one run).`,
  },
  {
    key: 'rollout',
    prompt: `LENS: THE ROLLOUT. Walk it: the guard command of docs/units-plan.md «Эксплуатация выката» run from
THIS worktree (does supabase/.temp link to the same project; HEAD_WANT=20260926102000;
LIST_WANT=20260926140000_service_booking_field.sql) — run ONLY the read-only parts: cloud head via
node scripts/cloud-read.mjs docs/rollout/remote_head.sql, and "npx supabase db push --linked --skip-vault
--dry-run" (dry run only!) to see the exact list. Then: main does not have this migration file — what breaks
if main is used for the next db push, migration list or eas update, and what is the smallest safe order
(e.g. merge the migration commit into main right after the push; is that a prod panel deploy with any
risk?). docs/rollout/postpush_step1.sql expects one overload of is_service_booking — does anything rerun it?
Locks and cron: does create function need anything paused? The post-push probe
docs/rollout/postpush_service_booking_field.sql: run it locally as supabase_read_only_user in a read-only
transaction and check every label against its header.`,
  },
]

const MAX_AGENTS = 2
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

phase('Lenses')

const results = await pipeline(
  LENSES,
  (l) => limited(`${CONTEXT}\n\n${l.prompt}`, { label: `lens:${l.key}`, phase: 'Lenses', schema: FINDING_SCHEMA }),
  (report, l) => {
    if (!report || report.findings.length === 0) {
      return { key: l.key, verified: report ? report.verified : [], confirmed: [], dropped: [] }
    }
    return parallel(
      report.findings.map((f) => () =>
        limited(
          `${CONTEXT}\n\nTry to REFUTE this finding by experiment or by reading the exact lines. If it does not reproduce, or no real caller can reach it, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
          { label: `refute:${l.key}:${f.severity}`, phase: 'Refute', schema: VERDICT_SCHEMA },
        ).then((v) => ({ finding: f, verdict: v })),
      ),
    ).then((judged) => ({
      key: l.key,
      verified: report.verified,
      confirmed: judged.filter(Boolean).filter((j) => !j.verdict || !j.verdict.refuted),
      dropped: judged.filter(Boolean).filter((j) => j.verdict && j.verdict.refuted),
    }))
  },
)

const out = results.filter(Boolean)
log(`confirmed ${out.flatMap((r) => r.confirmed).length}, dropped ${out.flatMap((r) => r.dropped).length}`)
return out
