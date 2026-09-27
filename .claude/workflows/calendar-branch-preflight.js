export const meta = {
  name: 'calendar-branch-preflight',
  description: 'Adversarial preflight of the whole f10-stage7-calendar branch (client code, data readers, release into main) before the merge',
  phases: [
    { title: 'Lenses', detail: 'panel code; data readers and release' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — the git worktree C:\\Users\\Roman\\Desktop\\Cleaning App\\.claude\\worktrees\\f10-stage7-calendar
(branch f10-stage7-calendar). CLAUDE.md states the rules. Work ONLY in this worktree; never git -C the main tree.

UNDER REVIEW: the whole branch against origin/main (git diff origin/main...HEAD): stage 7 of the web panel, the
calendar (docs/f10-plan.md, "Этап 7" and §1–§14; 7.1 property tree, 7.2 frame with row virtualization, 7.3 booking
bars, 7.4 task chips and filters, 7.5 expired/cancelled/repairs, 7.5a compact chip view, 7.5b columns filling the
width, 7.6 stand tooling and numbers), plus the task form's duplicate label, the select guard fix and the
apartments tree. The owner accepted 7.1–7.5 on the preview. Schema in the branch: 20260926140000 (in the cloud and
on main) and 20260926160000_pinned_cleaning (NOT in the cloud; its own preflights ran: pinned-cleaning-preflight,
pinned-cleaning-fixes-preflight — do not re-review its SQL). No client code in the branch may read
pinned_arrival/pinned_departure or send p_expected_date before that migration is rolled out.

TOOLS: npm scripts at the root (test:web, typecheck:web, lint via apps/web eslint, build:web). Local stack UP; psql
only in begin/rollback; never db:reset. Stand: CALENDAR_FIXTURE=1 with apps/web (see docs/f10-plan.md §5); if you
start a server, use port 8096 and stop it when done. CLOUD read-only: node scripts/cloud-read.mjs <file.sql>.
Never db push, never push to git, never merge. MEMORY: at most two agents at once; vitest with --maxWorkers=2.

CALIBRATION: report only what you SAW (an experiment's output or exact lines). An empty findings list is a fine
answer. Accepted decisions in docs/f10-plan.md are not findings.
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
    prompt: `LENS: THE PANEL CODE (apps/web/src/features/calendar, features/tasks, features/apartments, lib). By
reading and by running tests: React correctness (hooks order, effects and their cleanup, stale closures, keys,
the virtualizer, ResizeObserver width, localStorage failures), the chip and bar geometry at every depth and
view (full/compact) and width, filters and folding, dialogs routing (form / drawer / repair link), loading and
error states (LayerAlert, serverErrorText — raw error.message never on screen), accessibility (roles, names,
aria-pressed, keyboard reach, color not alone), i18n (every visible string keyed, three locales, plurals, no
Russian in code), the stand kept off production paths (dynamic import only, CALENDAR_FIXTURE server-only, marks
only on the stand). Run npm run test:web and typecheck:web once, and the eslint of apps/web.`,
  },
  {
    key: 'data-release',
    prompt: `LENS: DATA READERS AND RELEASE. (1) Every reader the branch adds or changes (calendar api.ts,
tasks/api.ts, use-calendar.ts month layers): its select string against packages/shared/src/database.types.ts and
the cloud (select guard READERS in apps/web/.../postgrest-select.test.ts — is every new reader listed?), paging
past PostgREST max_rows 1000, RLS assumptions (a manager sees what the calendar needs; nothing relies on the UI
for access), query volume per window change (month layers, neighbour prefetch, staleTime), nothing reading
pinned_* or sending p_expected_date yet. (2) Release into main: a merge of this branch into origin/main — run
git merge-tree against origin/main to list conflicts (dc237fa on main is a cherry-pick of this branch's
5922978); what main gets that the cloud does not have (the 20260926160000 file — a db push from main would then
carry it); npm run build:web of the branch; package-lock changes (React pinned to the root 19.2.3, no second
copy). Propose the safest order: migration push, then merge, or otherwise, with reasons.`,
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
