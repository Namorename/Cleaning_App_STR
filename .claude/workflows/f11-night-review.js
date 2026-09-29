export const meta = {
  name: 'f11-night-review',
  description: 'Adversarial review of the night fixes on f11-push (claim policy by type, free count in the morning summary, Expo mixed-projects resend)',
  phases: [
    { title: 'Lenses', detail: 'SQL: policy and summary; send-push: resend, fold, texts' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

// args: { base: '<commit before the night fixes>', bench: '<benchmark summary text>' }
const BASE = (args && args.base) || 'dddda09'
const BENCH = (args && args.bench) || '(no benchmark summary passed)'

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App, branch f11-push. CLAUDE.md states the rules.

UNDER REVIEW: git diff ${BASE}..f11-push — three low findings of the F11 preflight fixed during the night,
migrations edited in place (they are not in the cloud yet):
1. supabase/migrations/20260928110000_task_accept.sql — the policy "cleaner claims a free task on her listings"
   now requires type in ('cleaning', 'midstay') in USING (an inspection or maintenance is the office's, as in
   the phone's queue FREE_TASK_TYPES in apps/mobile/src/features/tasks/api.ts and the cleaning_free audience in
   20260928130000_push_events.sql). Test: supabase/tests/task_accept.sql.
2. supabase/migrations/20260928130000_push_events.sql — enqueue_daily_digest counts "free": unassigned
   cleaning/midstay tasks of the person's week (listing-local today .. today + task_horizon_days()) on listings
   she works (cleans_property_as), unless push_preferences.muted holds 'cleaning_free'; a person with only free
   work now gets a summary. send-push renders the line "Свободных на неделе: N" / "Free this week: N" /
   "Volných v týdnu: N" (fold.ts, texts.ts, push-texts.json and packages/shared/src/i18n/locales/*.json — the
   function's copy must equal the locales word for word). Owner's word 2026-09-29: add the line, three languages.
   Tests: supabase/tests/push_events.sql, send-push fold.test.ts and texts.test.ts.
3. supabase/functions/send-push/expo.ts and run.ts — a request Expo refuses with PUSH_TOO_MANY_EXPERIENCE_IDS
   (phones of more than one Expo project in one request) is split by the project mapping in the refusal's
   details and each part is sent apart; a group wholly in a failed part goes again, a group split across parts
   is settled as sent with a synthesized "RequestFailed" ticket for the undelivered phone. Tests: expo.test.ts,
   run.test.ts.

BENCHMARK (claim teams, local stack, rolled back): ${BENCH}

TOOLS: SQL only inside a transaction that ROLLS BACK: docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql
-U postgres -d postgres -v ON_ERROR_STOP=1 (begin; ... rollback;). Never DDL outside such a transaction, never
db reset, never db push, never the cloud. Functions: npx -y deno@2 test --allow-read supabase/functions/send-push/.
Phone i18n: in apps/mobile, npx jest src/i18n --maxWorkers=1 --forceExit. Do NOT edit files, do NOT commit.
MEMORY: at most two agents at once — run nothing heavy in parallel.

CALIBRATION: report only what you SAW — an experiment's output or the exact lines. An empty findings list is a
fine answer. Decisions recorded in docs/f11-plan.md and the owner's word above are not findings.
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
    key: 'sql',
    prompt: `LENS: THE SCHEMA. (1) The claim policy: with every permissive UPDATE policy on public.tasks as the
database has them (pg_policies), can a cleaner still take an unassigned inspection or maintenance — through
another policy, a definer RPC that assigns (grep the migrations for functions writing assignee_id), or by
changing type in the same UPDATE (guard_task_transitions)? Is the migration's comment about WITH CHECK right?
Does anything legitimate break — the phone's claimTask for a midstay, the office's panel, the generator?
(2) The summary's free count: does it count exactly what the phone's free queue shows her (read
apps/mobile/src/features/tasks/api.ts: the date bounds, types, RLS) and what the cleaning_free push announces
— rooms of a parent listing, other hosts, dismissed people, techs, a listing in 'auto' mode? Is muting read
right (push_preferences.muted, no row = everything on)? Is 'free' always present in params, and can a summary be
written that renders empty? Cost: the lateral calls cleans_property_as once per (person, free task) pair — weigh
it with the benchmark above. Run supabase/tests/push_events.sql and task_accept.sql once (each rolls back).`,
  },
  {
    key: 'send-push',
    prompt: `LENS: THE SENDER. (1) The mixed-projects resend (run.ts sendByProject, expo.ts mixedProjects and
ExpoMixedProjectsError): can a push be sent twice (a group retried after part of it went), or lost silently? What
if the mapping lists tokens not in the request, lists one token twice, lists one project only, or is empty? Does
the lease/deadline still hold when one request becomes several? Is a part that fails logged once, and the mix
itself? Does changing ExpoRequestError.name to type string break any caller (grep instanceof and .name)?
(2) The free line: fold.ts reads params.free with count(); a row queued by the old function has no 'free' —
rendered right? texts.ts order and separators; the three wordings as a cleaner reads them on a lock screen, in
Czech and English too; push-texts.json equal to the locales (texts.test.ts checks). Run the send-push tests once
and the phone's i18n test once.`,
  },
]

// The owner's word for the night of 2026-09-29: at most two agents at once.
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
