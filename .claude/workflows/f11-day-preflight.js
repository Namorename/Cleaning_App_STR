export const meta = {
  name: 'f11-day-preflight',
  description: 'Adversarial preflight of everything changed on f11-push since the F11 preflight: claim policy by type, take-without-status guard, cleaning_free narrowing, free line in the summary, Expo mixed-projects resend',
  phases: [
    { title: 'Lenses', detail: 'schema and access; pushes and the summary' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const BASE = (args && args.base) || 'dddda09'

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App, branch f11-push (checked out). CLAUDE.md states the rules.

UNDER REVIEW: git diff ${BASE}..f11-push — everything changed since the F11 preflight, migrations edited in place
(not in the cloud yet; docs/f11-plan.md, journal "Ночь 2026-09-29" and "День 2026-09-29", holds the owner's words):
1. 20260928110000_task_accept.sql — the claim policy's USING takes only type in ('cleaning','midstay');
   guard_task_transitions refuses an executor who changes assignee_id while leaving status 'unassigned'
   (a take must say so), and the trigger tasks_guard_transitions now fires on update of status, assignee_id.
2. 20260928130000_push_events.sql — push_on_task_change (INSERT and UPDATE branches) asks cleans_property_as
   only of people linked by property_cleaners to the listing or its parent (lateral join, owner's word
   2026-09-29); enqueue_daily_digest counts free cleanings (from today - task_grace_days() to today +
   horizon, cleanings only, not muted cleaning_free, the same narrowing) and sends a summary to someone with
   only free work. Tests: supabase/tests/push_events.sql, task_accept.sql.
3. supabase/functions/send-push — a PUSH_TOO_MANY_EXPERIENCE_IDS refusal is split by project and each part
   sent apart; the log names the projects (never tokens); fold/texts render the free line in three languages
   (push-texts.json must equal packages/shared/src/i18n/locales push.*).
4. package.json db:start:light (supabase start -x ...).

TOOLS: SQL only inside a transaction that ROLLS BACK: docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql
-U postgres -d postgres -v ON_ERROR_STOP=1 (begin; ... rollback;). The local DB runs f11-push's migrations.
Never DDL outside such a transaction, never db reset, never db push, never the cloud. Functions: npx -y deno@2
test --allow-read supabase/functions/send-push/. Do NOT edit files, do NOT commit. At most two agents at once —
nothing heavy in parallel.

CALIBRATION: report only what you SAW — an experiment's output or the exact lines. An empty list is a fine
answer. Decisions recorded in docs/f11-plan.md are not findings.
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
    key: 'schema-access',
    prompt: `LENS: SCHEMA AND ACCESS. (1) Taking free work: with every permissive UPDATE policy on public.tasks
(pg_policies), the guard and its new trigger columns, can a cleaner still end with her name on a row that is not
hers to take (a type that is not a cleaning, a row left 'unassigned', another host, a stale or beyond-horizon day)?
Can anything legitimate now be refused: the phone's claim ('accepted') and the old app's ('assigned'), a manager's
panel (save_task, assign_problem, direct updates), the generator and the sweep (no JWT), definer RPCs a cleaner
calls that touch assignee_id, a cleaner's own moves (accept, start, finish), a replay of a take? Does the trigger
now fire where it did not before and cost or break something (bulk updates by the generator, pg_trigger_depth)?
(2) Rollback notes in docs/rollout/postpush_f11.sql (f11-native only — read it with git show f11-native:...) still
right with the new trigger columns? Run supabase/tests/task_accept.sql once (it rolls back).`,
  },
  {
    key: 'push-summary',
    prompt: `LENS: PUSHES AND THE SUMMARY. (1) The narrowing of cleaning_free (INSERT and UPDATE branches): is the
audience exactly the set cleans_property_as would give over all phones — rooms of a linked listing, parts of a
villa (parent_id without hostaway_unit_id), a person linked to both a room and its listing (no duplicate rows),
another host, a dismissed or inactive person, a tech, 'auto' mode? Prove it with a rolled-back comparison against
the brute-force rule. Is the rule really asked only of the narrowed people (pg_stat_xact_user_functions with
track_functions = 'all')? (2) The summary: the free count against the phone's queue (apps/mobile/src/features/
tasks/api.ts), muting, the grace day, time zones, a summary that renders empty. (3) send-push: the resend by
project and its log (names, counts, no tokens), deadlines, duplicates; the free line's texts. Run
supabase/tests/push_events.sql and the send-push tests once.`,
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
return out.map((r) => ({
  key: r.key,
  confirmed: r.confirmed.map((c) => ({
    severity: c.finding.severity,
    title: c.finding.title,
    where: c.finding.where,
    what: c.finding.what,
    fix: c.verdict ? c.verdict.better_fix || c.finding.fix : c.finding.fix,
  })),
  dropped: r.dropped.map((d) => ({ severity: d.finding.severity, title: d.finding.title })),
}))
