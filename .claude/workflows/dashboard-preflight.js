export const meta = {
  name: 'dashboard-preflight',
  description: 'Short adversarial preflight of the basic dashboard (branch dashboard) before it is merged into main and pushed',
  phases: [
    { title: 'Lenses', detail: 'panel code; data readers and release' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar
(branch dashboard). CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree, never switch
its branch (the main tree holds f11-native and must stay as it is).

UNDER REVIEW: git diff main...HEAD — the basic dashboard of the web panel (stage 8 in its current look), plan and the
owner's decisions in docs/dashboard-plan.md («Решения владельца», «Как сделано»): six tiles (cleanings today «N ·
готово M»; no assignee — live tasks of EVERY kind, today through the sixth day on, by the listing's own day, today and
tomorrow apart; open tasks = problems; new supply requests; overdue repairs; repairs of switched-off technicians) and
the stuck repairs list; tiles link to sections without filters, except «Без исполнителя» → /calendar?assignee=nobody,
which the calendar page reads on the server (assigneeFromAddress, only "nobody"). Refresh: refetchInterval 60 s and
on window focus. The two repair counters MUST count by features/tasks/repairs.ts (isRepairOverdue, isTechnicianOff) —
no second copy of that rule. Also changed: fetchLiveRepairs' select (adds hostaway_unit_id, parent:parent_id(name)),
liveRepairSchema, useProblems/useSupplyRequests/useLiveRepairs take an optional refetchInterval, taskKeys.dashboard,
the calendar page became async with searchParams and keys the view by the filter. No schema change; the release is a
push to main (Vercel deploys the panel), no OTA.

TOOLS: in apps/web — npx vitest run <paths> --maxWorkers=2, npm run typecheck, npx eslint <paths>. A stand is RUNNING at
http://127.0.0.1:8096 (next start of this branch against the LOCAL stack; local schema = f11-native, a superset of
main's). Seeded host "Stand Dashboard": manager dashboard.manager@local.test, password in
C:\\Users\\Roman\\AppData\\Local\\Temp\\claude\\C--Users-Roman-Desktop-Cleaning-App\\0ea738da-f57e-4ff4-a958-50a7eb087e2d\\scratchpad\\stand-manager.secret
(never print it); puppeteer-core is installed in that scratchpad's drive/ folder (drive/dashboard.mjs is a working
driver). Do not stop or restart that server; do not rebuild. psql on the local db only inside begin/rollback; never
db:reset. CLOUD read-only: node scripts/cloud-read.mjs <file.sql> (no personal data in the report). Never db push,
never git push, never merge, never commit.

CALIBRATION: report only what you SAW (an experiment's output or exact lines). An empty findings list is a fine answer.
The owner's decisions in docs/dashboard-plan.md are not findings.
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
    key: 'panel',
    prompt: `LENS: THE PANEL CODE (apps/web/src/features/dashboard, the calendar page and chip-layer changes, the hooks
that gained refetchInterval). By reading and by experiment: do the counts match the owner's decisions exactly (types,
statuses, the listing's own day, the 7-day window edges, done vs cancelled/expired, one repair in both counters);
React correctness (useNow interval and cleanup, hydration of a 'use client' view rendered on the server, keys, the
calendar keyed by the filter — does a plain /calendar after /calendar?assignee=nobody reset the filter, does the
sidebar link still work), loading and error states (a failed read shows a dash and a LayerAlert with serverErrorText,
never raw error.message as the main text; a refetch error with data kept), accessibility (tile links' names, the list
labelled, marks not by colour alone), i18n (every visible string keyed in ru/en/cs, the dictionary: «Уборки» = tasks,
«Задания» = problems, «Заявки» = supplies; no «задача»/«проблема»), regressions in the tasks, problems, supplies and
calendar sections from the shared-hook changes. Run the dashboard and calendar tests and typecheck once; use the stand
to look at the real page if it helps.`,
  },
  {
    key: 'data-release',
    prompt: `LENS: DATA READERS AND RELEASE. (1) The changed reader fetchLiveRepairs: its select against
packages/shared/src/database.types.ts AND against the cloud (does properties.parent_id / hostaway_unit_id exist there,
is the nested parent:parent_id(name) embed inside properties!inner unambiguous — check pg_constraint on
public.properties via cloud-read.mjs; the select guard test apps/web/src/features/__tests__/postgrest-select.test.ts
covers it). Is anything in the branch reading schema the cloud does not have (compare the migrations main has with the
cloud head: docs/rollout/remote_head.sql via cloud-read.mjs)? (2) Load: four reads per minute per open dashboard —
fetchProblems and fetchSupplyRequests read everything with embeds: how many rows in the cloud today (counts only),
any paging limit (PostgREST max_rows 1000) the counts could silently hit; RLS assumptions (a manager sees all it
counts; nothing relies on the UI). (3) Release: git merge-tree of this branch against origin/main (conflicts?), what
the push to main deploys, the login landing on /dashboard for a manager — does a failure of one read leave the page
usable. Propose anything that must happen before the push.`,
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
