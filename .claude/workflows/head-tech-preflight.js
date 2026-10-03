export const meta = {
  name: 'head-tech-preflight',
  description: 'Adversarial preflight of the server part of the stages «Техник и главный техник» and «Видео» (branch tech-server) before the db push',
  phases: [
    { title: 'Lenses', detail: 'five independent readings: leaks, technician rules, dispatch and journal, push and video, the release' },
    { title: 'Refute', detail: 'one skeptic per critical, high or medium finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\head-tech (a git worktree, branch
tech-server; Supabase + Next.js manager panel apps/web + Expo maid app apps/mobile). CLAUDE.md states the rules. The
plan and the owner's decisions are docs/tech-plan.md — read §0, §2, §3, §5, §7, §10 and the rollout section first.

THE CHANGE: "git diff main...tech-server" in that worktree. Migrations, none in the cloud yet:
  20261003100000_head_tech_role (app_role += head_tech, one statement),
  20261003110000_tech_rules (guard_link_role on property_cleaners, guard_tech_role_change on profiles, save_task
  refuses cleanings for tech/head_tech), 20261003120000_head_tech_read (is_head_tech, head_tech_property_ids,
  staff_directory, five SELECT policies «head tech …», chat_participates and chat_participates_as),
  20261003130000_head_tech_dispatch (problem_for_dispatch, assign_problem, unassign_problem, the transaction-local
  flag str_ops.head_tech_dispatch read by head_tech_dispatching() in guard_task_fields and guard_task_transitions),
  20261003140000_problem_events (enum problem_event_kind, table problem_events, journal_problem_change,
  journal_repair_change), 20261003150000_push_kind_problem_new (push_kind += problem_new, one statement),
  20261003160000_head_tech_push (push_on_problem_reported, claim_push_batch, push_on_chat_message,
  enqueue_daily_digest, push_on_task_change, chat_unread_threads), 20261003170000_video_limits (hosts.video_max_sec,
  video_bitrate_kbps, video_max_mb; update_host_settings with 5 arguments; add_task_media limits and camera only).
  Also on the branch: 2a3d951, a types-only phone commit (TaskPushKind without problem_new, kind lists of 11).
SQL suites supabase/tests/tech_rules.sql, head_tech.sql, head_tech_push.sql, problem_events.sql, video_limits.sql and
rows in rls_smoke, chat, table_grants, problems, push_recipients. Edge Functions changed: manage-staff (role list,
refusalFromDatabase 409), send-push (texts and kinds). Probe docs/rollout/postpush_tech.sql, pre-push read
docs/rollout/prepush_tech.sql.

OWNER'S DECISIONS (2026-10-01 and 2026-10-03, docs/tech-plan.md §10): a technician sees and does only the problems
assigned to him, never cleanings; the head technician sees every problem of every apartment (archived and closed
too) with history, the repairs and their photos, the places of those problems including door codes, writes in every
problem thread, keeps his inbox with the office, assigns problems to technicians and takes anyone (a cleaner too)
off a repair; cancel, close and archive stay with the manager; he never sees cleanings, inspections, midstay,
reservations, the free queue, colleagues' email and phone, supply requests. Push «Новое задание» to head techs. Video:
720p, 2 Mbit/s, up to 120 s, up to 45 MB on the free plan; only the app's camera, no gallery.

CLOUD (read 2026-10-03, counts only): head 20260928140000; one company; active people: 1 tech, 1 cleaner, 1 manager (inactive: 2 cleaners,
1 manager); the tech has 27 property links, all in mode claim (none auto); no open cleaning, midstay or inspection on
a tech; problems: open 4, assigned 1, resolved 2, archived 1; one live repair (assigned); 1 push token, empty
queue; no head tech exists yet; hosts has no video columns yet.
The phones run build 1.1.0 (F11); the production panel is main (Vercel deploys every push to main) and does not know
head_tech: its «Команда» form reads an unknown role as cleaner (tech-plan §3.5).

TOOLS: npm run test:rls (local stack is UP; it resets nothing), psql only inside begin/rollback via
docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres; NEVER db:reset, never db push, never git push,
never deploy, never edit repository files. Deno: npx -y deno@2 test --allow-read supabase/functions/<fn>/ (then
git checkout -- deno.lock). Every jest/vitest/tsc/deno/test:rls run goes through the machine lock:
node "C:/Users/Roman/AppData/Local/Temp/claude/C--Users-Roman-Desktop-Cleaning-App/041fe977-6cec-4744-8726-812424758a6e/scratchpad/testlock.mjs" preflight -- <command>
CLOUD read-only: node scripts/cloud-read.mjs <file.sql> from the main tree, counts only, no personal data in the
report. MEMORY: at most two agents at once.

CALIBRATION: report only what you SAW — an experiment's output (in a rolled-back transaction) or exact lines. An
empty findings list is a fine answer. Decisions recorded in docs/tech-plan.md are not findings; a finding that a
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
    prompt: `LENS: WHAT THE HEAD TECHNICIAN (AND ANYONE ELSE) CAN READ THAT HE MUST NOT. Act as each person in rolled-back
transactions (request.jwt.claims): a head tech, a tech, a cleaner, a manager, a dismissed head tech, another company's
head tech. Through every path: table reads with PostgREST embeds (problems → tasks → reservations, task_media →
tasks, properties → children, chat_threads/chat_messages of cleanings), storage.objects of task-media (a cleaning's
photo through its path), every security definer function callable by authenticated (staff_directory, chat RPCs,
unread counts, head_tech_property_ids, the journal), views if any, the push data. EXECUTE grants of every new
function for anon/authenticated/PUBLIC (pg_proc.proacl), table grants of the new table (pg_class.relacl). The
transaction-local flag str_ops.head_tech_dispatch: can any client set it, or leave it on for a later statement?`,
  },
  {
    key: 'tech-rules',
    prompt: `LENS: THE TECHNICIAN HOLDS NO CLEANING. Every way a cleaning, midstay or inspection can end up on a tech or
head tech: save_task (create, edit person, edit type), a manager's direct PATCH of tasks.assignee_id, the generator
(auto links; a link made before the rule), claim/take, assign_problem on a non-repair, a role change while links or
open cleanings exist (both paths: profiles as a manager, manage-staff as service_role), the race of a role change with
a link or an assignment. And the other side: nothing changed for cleaners and managers — run the old suites' claims.
Prove each with a rolled-back experiment.`,
  },
  {
    key: 'dispatch-journal',
    prompt: `LENS: DISPATCH AND THE JOURNAL. assign_problem and unassign_problem by the head tech against the two task
guards (guard_task_fields, guard_task_transitions): a reassignment, a move of a live attempt, accepted back to
assigned, a stale screen, two dispatchers at once (head tech and manager), his own repair written directly (must
still be held), assigning to a cleaner (refused for him, allowed for a manager). problem_events: every kind written
exactly once with the right actor and parameters, nothing for cleanings, no client can write or delete, who reads it,
its cost inside the generator and inside a manager's bulk action (measure through the call, rolled back).`,
  },
  {
    key: 'push-video',
    prompt: `LENS: PUSH AND VIDEO. Push: the new kind for a new problem (audience: active head techs of the host, not the
reporter; preferences, quiet hours, settle), chat_message and daily_digest now reaching the head tech (every problem
thread; never a cleaning thread; the digest without a «free» line), the move of a repair by the head tech told as the
office's, send-push texts in three languages and their copy test, what a 1.1.0 phone does with an unknown kind
(apps/mobile/src/features/push/payload.ts). Video: add_task_media called exactly as the 1.1.0 phone calls it today
(no new arguments) — nothing breaks for photos; a gallery video refused; size and length limits from hosts with the
tolerance; who can change the three numbers; defaults. Run the deno tests of send-push and manage-staff.`,
  },
  {
    key: 'release',
    prompt: `LENS: THE RELEASE. (1) db push of exactly the files above after the cloud head, each its own transaction —
what a push stopped part-way leaves (the enum file alone; rules without read rights; push trigger without the kind),
docs/rollout/postpush_tech.sql run against the local stack (docker psql) — does every expected value in its header
match, and does it really check ACLs through relacl/proacl? (2) Between the push and the redeploys: the old
manage-staff (no head_tech in its role list) and old send-push (no text for the new kind) against the new schema;
the production panel on main and the 1.1.0 phones against the new schema — save_task, assign_problem,
add_task_media and chat RPCs called with the old arguments; the panel's «Команда» form and the head_tech role
(§3.5). (3) The cloud's existing rows: the technician's 27 links (are any auto?), open cleanings on techs.
(4) Rolling back. Propose the safest order with reasons.`,
  },
]

const REFUTED_SEVERITIES = ['critical', 'high', 'medium']

// Two agents at most on the machine (owner, 2026-10-03); the phone line of the redesign runs one alongside.
const MAX_AGENTS = 1
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
