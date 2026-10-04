export const meta = {
  name: 'staff-disable-preflight',
  description: 'Adversarial preflight of 20261004100000_staff_disable (switching an account off takes it off every job nobody has started; the cleanup of the 87 cleanings hanging on people switched off) and the dashboard tile, before the db push',
  phases: [
    { title: 'Lenses', detail: 'five readings: bypass, races, journal and push, cleanup and re-enable, grants and panel' },
    { title: 'Refute', detail: 'one skeptic per critical, high or medium finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\head-tech (a git worktree, branch
staff-disable; Supabase + Next.js manager panel apps/web + Expo maid app apps/mobile). CLAUDE.md states the rules. The
plan, the owner's word and every decision taken are docs/staff-disable-plan.md — read it whole first, then the header
of the migration.

THE CHANGE UNDER REVIEW: "git diff main...staff-disable" in that worktree. Schema: one migration, not in the cloud:
  supabase/migrations/20261004100000_staff_disable.sql —
  take_off_repairs(uuid[]) (cancel live repairs of tasks under the transaction-local flag str_ops.head_tech_dispatch,
  which journal_repair_change reads as taken_off and push_on_task_change as cleaning_unassigned); unassign_problem
  rewritten to call it (body otherwise from 20261003130000); release_work_of_inactive(uuid) (locks the problems of
  the person's unstarted repairs FOR NO KEY UPDATE in id order, then the attempts FOR UPDATE, take_off_repairs; every
  other unstarted job — 'unassigned' with her name, assigned, accepted — to assignee null + 'unassigned'; her 'auto'
  links to 'claim'; her unsettled push rows settled as 'skipped' unless a sender holds the group, under the
  advisory lock claim_push_batch takes — added after the first preflight run wf_83951e08-829); trigger profiles_release_work (AFTER UPDATE OF is_active, WHEN old.is_active AND NOT
  new.is_active); guard_person_works with triggers tasks_person_works_insert / tasks_person_works_update (refuse a live
  job naming a person switched off: insert, change of person, closed → live, started → unstarted; FOR SHARE on the
  profile row; hint serverErrors.taskAssigneeInvalid); guard_auto_link_works with trigger property_cleaners_auto_works
  (no 'auto' link for a person switched off; hint serverErrors.cleanerAutoInactive); and a do-block at the end that
  calls release_work_of_inactive for everybody already switched off.
  Tests: supabase/tests/staff_disable.sql (63 checks), supabase/tests/push_events.sql (one fixture row removed).
  Panel: apps/web/src/features/dashboard (tile «Уборок у отключённых», list off-staff-work.tsx, off-work-form.tsx,
  counts.ts offStaffWork), apps/web/src/features/tasks/api.ts fetchOffStaffWork (+ schema, keys), team/use-team.ts
  (cache refresh after a person is saved switched off), locales packages/shared/src/i18n/locales/*.json.
  Release pieces: docs/rollout/staff_disable_probe.sql (pre-push counts), docs/rollout/postpush_staff_disable.sql
  (expected values in its header), the gate command in docs/staff-disable-plan.md §9.

OWNER'S WORD (2026-10-04, item 5, quoted in the plan §0): switching an account off takes every unstarted job
(assigned, accepted) — cleanings and repairs — off it: a cleaning becomes free, a repair's task (problem) open again;
started ones (in_progress, paused) are not touched but must be visible to the manager as needing a decision; the
generator must not hand new cleanings to a person switched off through an old 'auto' link; switching back on brings
nothing back; what hangs today (test accounts and others) is cleared once, in the same migration, counted by a probe.

CLOUD (read 2026-10-04 with the probe, counts only): head 20261003170000; one company; working: 1 tech, 1 cleaner,
1 manager; switched off: 2 cleaners, 1 manager; the cleanup releases 87 cleanings (type cleaning, all 'assigned', all
from bookings, on active listings, 2026-10-03 … 2027-07-09: 21 in the week, 1 yesterday, 65 later), 0 repairs, 0
links; 0 'auto' links in the whole company; 0 push rows it would queue; 0 work under way on people switched off; 1
push token; empty queue. The production panel is main (Vercel deploys every push to main); the phones run build
1.1.0. manage-staff writes profiles with the service key (auth.uid() is null); a manager may also PATCH profiles.

TOOLS: npm run test:rls (the local stack is UP; it resets nothing), psql only inside begin/rollback via
docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres; the local stack is shared — check first that its
function bodies are this branch's (md5 in the header of postpush_staff_disable.sql); NEVER db:reset, never db push,
never git push, never deploy, never edit repository files. Every jest/vitest/tsc/test:rls run goes through the
machine lock:
node "C:/Users/Roman/AppData/Local/Temp/claude/C--Users-Roman-Desktop-Cleaning-App/041fe977-6cec-4744-8726-812424758a6e/scratchpad/testlock.mjs" preflight -- <command>
(vitest of the panel: npx vitest run <files> --testTimeout=15000 --maxWorkers=2 from apps/web).
CLOUD read-only: node scripts/cloud-read.mjs <file.sql>, counts only, no personal data in the report.
Concurrency in SQL can be reproduced with two psql sessions (one in the background holding a transaction open, e.g.
with pg_sleep) — both rolled back. MEMORY: at most two agents at once on the machine.

CALIBRATION: report only what you SAW — an experiment's output (in a rolled-back transaction) or exact lines. An
empty findings list is a fine answer. Decisions recorded in docs/staff-disable-plan.md (§2, §2.1, §2.2, §4, §5, §10)
are not findings; a finding that a recorded decision has a consequence nobody wrote down is.
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
    key: 'bypass',
    prompt: `LENS: CAN THE RULE BE GOT ROUND. After a person is switched off, can any unstarted job still carry her name, or
can any live job be written with it? Walk every path that switches a person off (manage-staff's upsert as the service
role — INSERT … ON CONFLICT DO UPDATE fires which triggers? —, a manager's PATCH of profiles, a profile deleted, a
person moved to another company, an insert of a profile already switched off) and every writer of tasks.assignee_id /
tasks.status and of property_cleaners: save_task, assign_problem, unassign_problem, the take («Взять», RLS policy
"cleaner claims a free task on her listings"), accept/start/finish by the executor, the generator
(generate_cleaning_tasks: insert, relocate, reschedule, refresh, hand-over, cancel), set_property_status, the archive
and cancel paths of problems, expire_stale_tasks, room moves, a manager's direct INSERT/PATCH, the phone's offline
queue replaying an old write after she was switched off. For each: is the person's name refused, is unstarted work
left on her, or is a legitimate write now refused? Look hard at the WHEN of tasks_person_works_update (a write that
names the same person while moving the status from 'unassigned' to 'assigned', a row 'unassigned' with a name, a
type change), at the statuses the release treats as unstarted ('unassigned', 'assigned', 'accepted') against
everything that counts as live elsewhere, at 'blocked', and at a repair whose problem is archived or cancelled.
Prove each claim in a rolled-back transaction.`,
  },
  {
    key: 'races',
    prompt: `LENS: RACES AND LOCKS. The switch (UPDATE of profiles, then the AFTER trigger) against, at the same moment: a
generator run that already built its _wanted with her 'auto' link (insert and hand-over name her; its reschedule pass
may already hold one of her rows), a dispatch (assign_problem / unassign_problem: problem row FOR NO KEY UPDATE, then
the attempt), her own take or start from the phone, save_task naming her (FOR SHARE in save_task and in the guard),
save_property_cleaner setting her 'auto', and a second switch of the same person. Reproduce with two psql sessions
(both rolled back; one waits on a lock, pg_locks shows it) and say for each: who waits for whom, what each sees
after the wait, can unstarted work survive on her, can a deadlock (40P01) arise beyond the one the plan §5 accepts,
does lock_timeout or the generator's 8 s budget change anything. Then the cost: what the guard and the release add
to the generator and to a big switch — measure through the call (a definer function is not inlined; see
docs/tech-plan.md §12 for the tech rule's numbers), rolled back.`,
  },
  {
    key: 'journal-push',
    prompt: `LENS: JOURNAL AND PUSH. take_off_repairs now carries the write unassign_problem made itself: is unassign_problem's
behaviour unchanged for every caller (the manager, the head technician, a stale screen with p_expected_assignee,
the guards' head_tech_dispatching() at the trigger depth it now runs at, the flag reset after the write — what if the
cancel raises, what if take_off_repairs is called with the flag already on)? For a switch: what problem_events rows
are written (kind, actor_id for manage-staff, for a manager's PATCH, for the migration's cleanup; params), is the
mirror's status right for an archived, a cancelled or a resolved problem, and what push rows are queued — none for
the person switched off (written AND claimed: push_on_task_change and claim_push_batch), cleaning_free for whom,
cleaning_unassigned / cleaning_cancelled for whom, anything for the head technician or the manager, the morning
digest (enqueue_daily_digest) for her and for her colleagues. Compare with docs/staff-disable-plan.md §2.1 and §2.2
and with send-push (supabase/functions/send-push): does any queued kind or parameter reach a text that is wrong now?`,
  },
  {
    key: 'cleanup-reenable',
    prompt: `LENS: THE ONE-OFF CLEANUP AND SWITCHING BACK ON. The do-block at the end of the migration runs once, as postgres,
with nobody signed in, over everybody already switched off, after the triggers exist. Read the cloud again with
docs/rollout/staff_disable_probe.sql (counts only) and check every label against an independent query of your own
(still read-only, counts only): would the cleanup write exactly what the probe says (87 cleanings, 0 repairs, 0
links, 0 push rows, 0 handover) — and is the probe itself right (build a fixture in a rolled-back transaction with
session_replication_role = replica for the state "before the rule", run the probe, run the do-block, compare)? Can
the do-block fail or time out in the cloud (lock_timeout 3s, a concurrent process-webhook-events run, the 87 rows'
other triggers: snapshot_task_steps, mirror, push, touch), and if it does, what is left? Is it safe to run twice?
Then switching back on: nothing comes back (jobs, repairs, links), the generator over her old listings after she is
back, her 'claim' place in the queue, the panel's «Команда» form re-enabling her and ticking listings in one save.`,
  },
  {
    key: 'grants-panel',
    prompt: `LENS: RIGHTS AND THE PANEL. Run docs/rollout/postpush_staff_disable.sql against the local stack (docker psql) and
compare every value with its header; check that no new function is executable by anon, authenticated or PUBLIC
(aclexplode, not information_schema), that the trigger functions cannot be called, that table grants did not move
(supabase/tests/table_grants.sql), and that the CHECK and RLS still hold for the rows the release writes. Then the
panel, read and run (vitest through the lock): fetchOffStaffWork's select and filters against database.types.ts and
the real PostgREST (the !inner embed through the foreign key hint with a filter on the embedded column, RLS of
profiles for a manager, the archive rule), the tile's count against the server's rule (anything counted twice with
«Ремонтов у отключённых», anything missed — a repair written by hand, a 'blocked' job, a job on an archived listing),
the list and the form it opens (an in-progress job of a person switched off — can the manager actually hand it on,
what does the form send, what does save_task answer), keys in three languages and the words of CLAUDE.md
(«Уборки» = tasks, «Задания» = problems; no «задача»/«проблема»), accessibility of the row's button, and the cache
refresh in team/use-team.ts. Last: is anything in the panel's diff unsafe to ship to main before the db push?`,
  },
]

const REFUTED_SEVERITIES = ['critical', 'high', 'medium']

// Two agents at most on the machine (owner, 2026-10-03); the other line has none while this runs.
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
