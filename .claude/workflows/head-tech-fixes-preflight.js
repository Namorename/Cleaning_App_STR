export const meta = {
  name: 'head-tech-fixes-preflight',
  description: 'Short adversarial preflight of fe55623, the fixes to the findings of head-tech-preflight (the table-level rule on tasks, the link trigger on every write, dispatch on repairs only, expected assignee), before the db push',
  phases: [
    { title: 'Lenses', detail: 'two readings: the new triggers against every writer, dispatch and the probe' },
    { title: 'Refute', detail: 'one skeptic per critical, high or medium finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\head-tech (a git worktree, branch
tech-server; Supabase + Next.js manager panel apps/web + Expo maid app apps/mobile). CLAUDE.md states the rules. The
plan and the owner's decisions are docs/tech-plan.md — read §0, §2, §3, §5, §7, §10 and the rollout section first.

THE CHANGE UNDER REVIEW NOW: "git diff 95cf3fa..fe55623" in that worktree — the fixes after the first preflight
(.claude/workflows/head-tech-preflight.js, run 2026-10-03: 0 critical, 0 high, 4 medium confirmed, 17 low). The whole branch
is "git diff main...tech-server". Migrations, none in the cloud yet:
  20261003100000_head_tech_role (app_role += head_tech, one statement),
  20261003110000_tech_rules (guard_link_role on any insert or update of property_cleaners, guard_cleaning_assignee
  on tasks — trigger tasks_no_cleaning_for_tech: no cleaning, midstay or inspection with a tech/head_tech on it,
  whoever writes — guard_tech_role_change on profiles, save_task's early check of the same rule),
  20261003120000_head_tech_read (is_head_tech, head_tech_property_ids,
  staff_directory, five SELECT policies «head tech …», chat_participates and chat_participates_as),
  20261003130000_head_tech_dispatch (problem_for_dispatch, assign_problem, unassign_problem(p_task_id,
  p_expected_assignee), the transaction-local
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
    key: 'triggers',
    prompt: `LENS: THE NEW TRIGGERS AGAINST EVERY WRITER. tasks_no_cleaning_for_tech (guard_cleaning_assignee, BEFORE INSERT
OR UPDATE OF assignee_id, type, WHEN cleaning/midstay/inspection with an assignee) and property_cleaners_no_tech now on
every insert or update. Walk every writer of tasks and property_cleaners in the schema and the Edge Functions
(generate_cleaning_tasks and its handover, sync-reservations / process-webhook-events, the archive and cancel paths,
expire-stale-tasks, save_task, claim/take, the mirror, room_cleanings, pinned moves, the panel's direct writes, the
phone's queue): can any legitimate write now be refused, can any write still put a cleaning on a tech or head tech, can
the generator meet the refusal and roll back for every company (what old rows would it take — check the cloud counts),
does FOR SHARE on profiles add a deadlock with the role guard or with save_task, and what does the trigger cost inside
the generator (measure through the call, rolled back; the fix's numbers are in docs/tech-plan.md §12).`,
  },
  {
    key: 'dispatch-probe',
    prompt: `LENS: DISPATCH AND THE PROBE. assign_problem on repairs only (a live non-repair with the problem_id now refuses
with serverErrors.problemNotOpen — is that the right answer and text, and can such a row exist), the head tech moving a
cleaner's repair (same holder → day/hours allowed; a new holder still needs tech/head_tech — any way to hand it to a
cleaner through a move), unassign_problem(p_task_id, p_expected_assignee default null) — the old one-argument call,
a stale screen, the lock order. Then the release pieces: run docs/rollout/postpush_tech.sql against the local stack
(docker psql) and compare every value with its header; read docs/rollout/prepush_tech.sql against the cloud with
cloud-read.mjs (counts only) and say whether the §12 gate (tech_links = {}, tech_cleanings = {}) holds today.`,
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
