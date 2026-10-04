export const meta = {
  name: 'staff-disable-fixes-preflight',
  description: 'Short adversarial preflight of the fixes after staff-disable-preflight (run wf_83951e08-829) and the owner\'s answers of 2026-10-04: links of a person switched off deleted and refused in any mode, the cause of a take-off in the journal and its line in the panel, the push queue settled at the switch (bb87362), before the db push',
  phases: [
    { title: 'Lenses', detail: 'three readings: links and the «Команда» form, the cause in the journal, the queue settled under the advisory lock' },
    { title: 'Refute', detail: 'one skeptic per critical, high or medium finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\head-tech (a git worktree, branch
staff-disable; Supabase + Next.js manager panel apps/web + Expo maid app apps/mobile). CLAUDE.md states the rules. The
plan, the owner's word, his answers of 2026-10-04 (§10) and every decision taken are docs/staff-disable-plan.md —
read it whole first, then the header of supabase/migrations/20261004100000_staff_disable.sql.

THE CHANGE UNDER REVIEW NOW — the commits after the first preflight (.claude/workflows/staff-disable-preflight.js, run
wf_83951e08-829; no critical or high in the code). Read them with "git show <hash>" in the worktree:
  272bcf2 test(db) + bb87362 fix(db): switching a person off settles her unsettled rows of raw.push_outbox as
    'skipped' (settled_at, claimed_until null) unless a sender holds the group (claimed_until in the future), after
    pg_advisory_xact_lock(hashtext('public.claim_push_batch')) — inside release_work_of_inactive, which runs in the
    AFTER trigger profiles_release_work, i.e. inside manage-staff's upsert of the profile or a manager's PATCH, and in
    the migration's one-off do-block.
  bedd46d fix(web): the hint above «Уборки в работе у отключённых».
  48620b2 test(db,web) + 4137cf4 feat(db,web): the owner's answers —
    (1) release_work_of_inactive DELETES every property_cleaners row of the person (any mode); the link guard is now
        guard_link_works / trigger property_cleaners_person_works: BEFORE INSERT OR UPDATE of any link, refuses a
        person switched off (FOR SHARE on her profile row; hint serverErrors.cleanerLinkInactive; the old
        cleanerAutoInactive, never in the cloud, is gone). The panel's «Команда» writes the account through
        manage-staff before the links (apps/web/src/features/team/staff-form.tsx: save.mutate → finish → applyLinks);
    (3) take_off_repairs(p_task_ids uuid[], p_cause text default null) sets a second transaction-local flag,
        str_ops.take_off_cause, for its write; journal_repair_change (copied from 20261003140000, cause added) writes
        params.cause = 'account_disabled' into taken_off; unassign_problem calls without a cause. Panel:
        apps/web/src/features/problems/history.ts (takenOffKey) and keys panel.problems.history.* in three languages —
        there is no history screen in any branch yet; the phone draws no history.
  de73e73, 845b564 and the docs commit of this round: plan, probe, post-push check.
SQL suite supabase/tests/staff_disable.sql (67 checks). Not in the cloud. Cloud now (probe, read-only): head
20261003170000; the cleanup would release 87 cleanings ('assigned'), 0 repairs, 0 links; nobody switched off has a row
waiting in the push queue; one cleaning_free of someone else waits.

TOOLS: the local Supabase stack is UP and SHARED with another line of work. Use it ONLY inside transactions that roll
back: docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres, every script beginning with begin
and ending with rollback. NEVER commit on it, never run db:reset, never start another container or stack, never db
push, never git push, never deploy, never edit repository files. Concurrency: two psql sessions, each in its own
transaction, both rolled back (one may hold a lock with pg_sleep in the background). Every file you write goes to the
scratchpad with your lens as its prefix (links-*, journal-*, queue-*) — other agents write there too. Every
jest/vitest/tsc/test:rls run goes through the machine lock:
node "C:/Users/Roman/AppData/Local/Temp/claude/C--Users-Roman-Desktop-Cleaning-App/041fe977-6cec-4744-8726-812424758a6e/scratchpad/testlock.mjs" preflight -- <command>
(npm run test:rls only reads — its suites roll back; vitest of the panel: npx vitest run <files> --testTimeout=15000
--maxWorkers=2 from apps/web). CLOUD read-only: node scripts/cloud-read.mjs <file.sql>, counts only, no personal data
in the report. At most two agents on the machine: this scenario runs one at a time.

CALIBRATION: report only what you SAW — an experiment's output (rolled back) or exact lines. An empty findings list is
a fine answer. The owner's answers and the decisions in docs/staff-disable-plan.md are not findings; a consequence of
one that nobody wrote down is.
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
    key: 'links',
    prompt: `LENS: LINKS OF A PERSON SWITCHED OFF, AND THE «КОМАНДА» FORM. (a) The release deletes every link of hers: walk
what reads property_cleaners — cleans_property / cleans_property_as and the policies over tasks and chat, the
generator's auto_cleaner_id, the push audience of free work and the morning digest, the panel's team list, links
editor and listing card (apps/web/src/features/team, apps/web/src/features/apartments/cleaners-tab.tsx) — does
anything break or mislead once her rows are gone (a count, a «Закреплён» slot, a chat thread she wrote in)? (b) The
guard on any write of a link: every writer — save_property_cleaner (INSERT … ON CONFLICT DO UPDATE: which triggers
fire, in which order, with guard_link_role of the technician rule), a manager's direct write, the server; the form
paths: create a person, edit a person, switch on and tick listings in one save, switch off and tick listings in one
save, edit somebody left switched off, the links editor's mode and priority on an old link, removing links. Reproduce
the form's sequence of writes against the stack (rolled back; the manage-staff upsert can be done as a plain
INSERT … ON CONFLICT DO UPDATE with no JWT) and say what the manager sees at each step (the refusal key and how
staff-form.tsx shows it — linkFailure). (c) Can a link of hers survive the switch (a link written in the same second:
FOR SHARE against the switch's row lock), and is the cloud's 0 links of people switched off still 0 (probe)?`,
  },
  {
    key: 'journal',
    prompt: `LENS: THE CAUSE IN THE JOURNAL AND ITS LINE. Diff journal_repair_change in 20261004100000 against
20261003140000 (only the cause may differ) and check every kind it writes still writes what it wrote. take_off_repairs:
the two flags set and reset around one write — what if the write raises (the flags are transaction-local; is a later
write in the same transaction ever journaled with a stale cause, e.g. a release that takes several people off in one
transaction, the migration's do-block over all people switched off, or unassign_problem called after a release in the
same transaction)? A take-off by unassign_problem must carry no cause; by the switch, 'account_disabled' — through
manage-staff (no JWT), a manager's PATCH, the migration's cleanup. An unknown p_cause is refused. Then the panel:
apps/web/src/features/problems/history.ts and panel.problems.history.* in three languages — the words of CLAUDE.md
(«Задания» = problems; no «задача»/«проблема»), {{name}} in both, an unknown cause or missing params reading as the
plain line, and the i18n parity and section-name tests (apps/mobile/src/i18n/__tests__/i18n.test.ts, run through the
lock). The phone draws no history: confirm, and that nothing on the phone reads params.cause.`,
  },
  {
    key: 'queue',
    prompt: `LENS: THE QUEUE SETTLED AT THE SWITCH (bb87362). release_work_of_inactive takes
pg_advisory_xact_lock(hashtext('public.claim_push_batch')) inside the AFTER trigger on profiles, i.e. while the switch
holds her profile row, the problems and attempts of her repairs, her jobs and her links, until manage-staff's
transaction (or the migration) commits. Look for a lock cycle with claim_push_batch (it holds the advisory lock, then
updates raw.push_outbox and reads profiles, tasks, chat_threads), record_push_results and the send-push Edge Function
(supabase/functions/send-push), the push triggers on tasks and chat that insert into the queue in the same
transaction, and the daily digest. Reproduce with two sessions, rolled back: a claim under way while a person is
switched off, and the other order; say who waits for whom and for how long, and whether a deadlock (40P01) can arise.
Then the semantics: a leased group left to its sender (is the lease ever released with her rows unsettled and sent
later — what does claim do with them then), rows of kind daily_digest (unique index push_outbox_digest_once) and
chat_message, a person switched off and on again inside one transaction, and the migration's do-block holding the
advisory lock for the whole push — what does send-push do meanwhile (cron every minute)?`,
  },
]

const REFUTED_SEVERITIES = ['critical', 'high', 'medium']

// Two agents at most on the machine (owner, 2026-10-03); the redesign line runs one alongside.
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
          `${CONTEXT}\n\nYou are the skeptic of lens ${l.key}: your scratchpad files take the prefix refute-${l.key}-. Try to REFUTE this finding by experiment (rolled back) or by reading the exact lines. If it does not reproduce, or no real caller can reach it, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
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
