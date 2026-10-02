export const meta = {
  name: 'f11-preflight',
  description: 'Adversarial preflight of F11 (push schema М1–М3b, send-push, T1, T2) before the owner\'s ultrareview and the db push',
  phases: [
    { title: 'Lenses', detail: 'five independent readings: leaks, events, races and budget, the sender, the release' },
    { title: 'Refute', detail: 'one skeptic per critical, high or medium finding' },
  ],
}

const BENCH = (args && args.bench) || '(no fresh measurement passed — use the preliminary one in docs/f11-plan.md, «Замер»)'

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel apps/web + Expo maid
app apps/mobile). CLAUDE.md states the rules. The plan, the owner's decisions (section «Решения владельца») and the
rollout recipe are docs/f11-plan.md — read it first, including «Этап 2 — ход работы».

BRANCHES: f11-push (schema, send-push, T1) and f11-native on top of it (T2, native build 1.1.0). The whole of F11 is
"git diff origin/main...f11-native". Five migrations, none in the cloud yet:
  20260928100000_push_recipients (М1: push_kind, push_tokens, push_preferences, register/unregister_push_token,
  set_push_preference), 20260928110000_task_accept (М2: guard, claim policy, accepted resets in save_task and
  assign_problem, archive cancels accepted), 20260928120000_participation_core (cleans_property_as,
  chat_participates_as), 20260928130000_push_events (М3: raw.push_outbox, triggers on tasks, chat_messages,
  reservations; enqueue_daily_digest), 20260928140000_push_sender (М3b: raw.push_tickets, claim_push_batch,
  record_push_results, receipts, forget_push_token, purge; crons send-push, push-daily-digest, push-history-purge).
  Edge Function supabase/functions/send-push (not deployed). SQL tests supabase/tests/push_*.sql, task_accept.sql.

CLOUD (read 2026-09-28, counts only): head 20260927120000; 7 cron jobs; active people: 1 cleaner, 1 manager;
next 7 days: 20 assigned + 156 unassigned open tasks; 0 accepted; 8 chat messages and 1556 booking updates in the
last 7 days. Before the push the phones run build 1.0.0 (no push code); main (production panel, Vercel deploys
every push to main) is 90a7bbc. Rollout order (plan §9): preflight -> owner's ultrareview -> db push of exactly
the five files (dry-run gate, docs/units-plan.md «Эксплуатация выката») -> docs/rollout/postpush_f11.sql ->
deploy send-push + EXPO_ACCESS_TOKEN (owner) -> f11-push into main (T1: panel and OTA to 1.0.0) -> f11-native
into main as the build commit -> EAS build 1.1.0.

GENERATOR BUDGET MEASUREMENT (the triggers inside generate_cleaning_tasks, 8 s budget of
20260923120000:107-109): ${BENCH}

TOOLS: npm run test:rls (local stack is UP; it resets nothing), psql only inside begin/rollback via
docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres; NEVER db:reset, never db push, never git push,
never deploy. Deno: npx -y deno@2 test --allow-read supabase/functions/. Mobile: in apps/mobile, npx jest <paths>
--maxWorkers=1 --forceExit. CLOUD read-only: node scripts/cloud-read.mjs <file.sql>, counts only, no personal data
in the report. Do NOT edit repository files. MEMORY: at most two agents at once.

CALIBRATION: report only what you SAW — an experiment's output (in a rolled-back transaction) or exact lines. An
empty findings list is a fine answer. Decisions recorded in docs/f11-plan.md are not findings; a finding that a
recorded decision has a consequence nobody wrote down is.
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
    key: 'leaks',
    prompt: `LENS: WHAT COULD LEAK. Through a push (title, body, data — send-push texts.ts/run.ts: never chat text,
never a guest name; what the lock screen shows), through a token (who can read, move or delete a push_tokens row;
a token moving between people on one phone; a dismissed person), through the event choice (push_preferences,
set_push_preference), through the rights: every new table and function — grants, RLS, security definer with
search_path '', EXECUTE of anon/authenticated/PUBLIC (the cloud's default privileges give authenticated EXECUTE
on new public functions — docs/rollout/postpush_f11.sql lists the expected ACLs; is the list right?), raw closed
to clients, the audience of each event (a cleaner told about a flat she does not clean, a chat push to someone no
longer a participant). Run test:rls once and the push/grant SQL tests.`,
  },
  {
    key: 'events',
    prompt: `LENS: ARE THE EVENTS RIGHT. push_on_task_change, push_on_chat_message, push_on_booking_status,
enqueue_daily_digest against section 1 of the plan: who acted (the actor is never told about her own act; the
generator vs a manager vs the cleaner), the seven-day horizon in the LISTING's timezone, a cleaning moved there
and back, moved out of the horizon, reassigned twice before the settle time, cancelled after being moved, quiet
hours 21:00–07:00 Prague and urgency (today/tomorrow), the fold order and collapse keys, a repair ("работа")
vs a cleaning, a chat message with only photos, the digest once a day across the summer-time change. Prove each
claim with a rolled-back experiment on the local stack.`,
  },
  {
    key: 'races-budget',
    prompt: `LENS: RACES AND BUDGET. (1) Races: two send-push runs at once (advisory lock + 2-min lease), a run dying
after claim and before record (lease expiry, double send?), record_push_results replayed, a token registered by
person B while a push to person A is being sent on it, forget_push_token after DeviceNotRegistered vs a fresh
registration, a phone's register racing its own unregister at sign-out, receipts claimed twice. (2) Budget: the
triggers inside the generator (measurement above) and on a manager's bulk action; the outbox and tickets growth
per day and the purge; cron.job_run_details growth with a job every minute; indexes used by claim_push_batch
(EXPLAIN on a filled outbox in a rolled-back transaction).`,
  },
  {
    key: 'sender',
    prompt: `LENS: THE SENDER (supabase/functions/send-push). Batches of 100 without splitting a group, receipts of
1000, 429/5xx back-off, ticket errors (DeviceNotRegistered -> forget_push_token; InvalidCredentials,
MismatchSenderId -> logged), reading claim_push_batch output as foreign input, the texts in three languages
(plural forms, unknown place, a kind this build does not know), the push data the phone parses
(apps/mobile/src/features/push/payload.ts must accept exactly what run.ts pushData sends), secrets
(EXPO_ACCESS_TOKEN only from the environment, never logged), what happens every minute between the db push and
the function's deploy (the cron calls invoke_edge_function('send-push') on a function that does not exist yet).
Run the Deno tests.`,
  },
  {
    key: 'release',
    prompt: `LENS: THE RELEASE. (1) db push: exactly the five files after 20260927120000, each its own transaction —
what a push stopped part-way leaves (M3 without M3b: triggers writing an outbox nobody sends; M2 without M1),
docs/rollout/postpush_f11.sql run against the local stack (docker psql) — does every expected value in its header
match? (2) Between the push and each merge: the production panel on main (90a7bbc) and the 1.0.0 phones against
the new schema — the M2 guard vs the 1.0.0 phone's claim and start (claim writes assigned in 1.0.0 — refused?),
save_task/assign_problem/set_property_status called by the old panel with the old arguments, the chat trigger on
the panel's messages. (3) The merges: f11-push into main (T1 OTA to 1.0.0; migration list --linked before
eas update), f11-native into main (the build commit; version 1.1.0 keeps its bundle off 1.0.0). (4) Rolling back:
what a revert of each piece means with accepted rows already written. Propose the safest order with reasons.`,
  },
]

const REFUTED_SEVERITIES = ['critical', 'high', 'medium']

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
    if (!report) {
      return { key: l.key, verified: [], confirmed: [], dropped: [], unrefuted_low: [] }
    }
    const toRefute = report.findings.filter((f) => REFUTED_SEVERITIES.includes(f.severity))
    const low = report.findings.filter((f) => !REFUTED_SEVERITIES.includes(f.severity))
    if (low.length > 0) {
      log(`${l.key}: ${low.length} low finding(s) passed on without a skeptic`)
    }
    return parallel(
      toRefute.map((f) => () =>
        limited(
          `${CONTEXT}\n\nTry to REFUTE this finding by experiment (rolled back) or by reading the exact lines. If it does not reproduce, or no real caller can reach it, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
          { label: `refute:${l.key}:${f.severity}`, phase: 'Refute', schema: VERDICT_SCHEMA },
        ).then((v) => ({ finding: f, verdict: v })),
      ),
    ).then((judged) => ({
      key: l.key,
      verified: report.verified,
      confirmed: judged.filter(Boolean).filter((j) => !j.verdict || !j.verdict.refuted),
      dropped: judged.filter(Boolean).filter((j) => j.verdict && j.verdict.refuted),
      unrefuted_low: low,
    }))
  },
)

const out = results.filter(Boolean)
log(`confirmed ${out.flatMap((r) => r.confirmed).length}, dropped ${out.flatMap((r) => r.dropped).length}, low ${out.flatMap((r) => r.unrefuted_low).length}`)
return out
