export const meta = {
  name: 'f11-native-review',
  description: 'Adversarial review of T2 (native build 1.1.0 of the maid app: pushes, NetInfo, Sentry) on branch f11-native before the preflight',
  phases: [
    { title: 'Lenses', detail: 'phone behaviour; build, privacy and rules' },
    { title: 'Refute', detail: 'one skeptic per finding' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App, branch f11-native. CLAUDE.md states the rules.

UNDER REVIEW: git diff f11-push...f11-native — step T2 of docs/f11-plan.md (section 5 "Телефон", section 6
"Нативная сборка 1.1.0", and the log entry "Т2 — натив сборки 1.1.0" under "Этап 2 — ход работы", which also
lists the accepted deviations from section 5). The maid app (apps/mobile, Expo SDK 57, RN 0.86.3) gets
expo-notifications, NetInfo and Sentry 8.28 in native build 1.1.0: features/push/*, lib/network.ts,
lib/sentry.ts, src/boot.ts + index.js entry, metro.config.js, app.config.ts, app.json, eas.json, the Settings
permission notice, the list notice after a tap, signOut order, locales. The server side (send-push, migrations)
is NOT under review; its payload contract is supabase/functions/send-push/run.ts pushData and messagesFor.

TOOLS: in apps/mobile: npx jest <paths> --maxWorkers=1 --forceExit, npx tsc --noEmit, npx expo lint,
npx expo config --json --type prebuild. Library sources are in node_modules (expo-notifications 57.0.21,
@react-native-community/netinfo 12.0.1, @sentry/react-native 8.28.0, @tanstack/query-core). Do NOT edit files,
do NOT commit, never run eas, never db push, never touch the cloud. MEMORY: at most two agents at once.

CALIBRATION: report only what you SAW — an experiment's output or the exact lines, library source included.
An empty findings list is a fine answer. Decisions recorded in docs/f11-plan.md are not findings.
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
    key: 'phone',
    prompt: `LENS: THE PHONE'S BEHAVIOUR. Walk the real paths against the library sources, not the mocks:
(1) cold start from a tapped push on iOS and Android (useLastNotificationResponse, clearLastNotificationResponse,
the (tabs) layout mounting after the session, followedTaps dedupe, router.push vs navigate to /(tabs) with a
notice, a tap while signed out, a tap on a push for a cleaning no longer hers); (2) sign-out order (forgetThisPhone
before auth.signOut, the 3 s bound, offline, the web build, a second person signing in on the same phone —
register moves the token; can anything replay as the wrong person?); (3) registration (channels before token and
before the permission question on Android 13, isRegisteredFor memo vs sign-out/sign-in, addPushTokenListener with
a device token, AppState 'active' frequency, errors reported vs swallowed, provisional iOS); (4) the foreground
handler (answers within 3 s, open-thread by threadId, which pushes are hidden); (5) permission states on both
systems (permissionState, the explainer prompt once a run, Settings notice after a request the phone never showed,
channel importance scales); (6) NetInfo with the probe (lib/online.ts, query-client retryMove, app-focus) — can the
app get stuck offline or flap?; (7) the list notice params (zod, setParams). Run the push, settings, tasks and lib
test files once.`,
  },
  {
    key: 'build-privacy-rules',
    prompt: `LENS: BUILD, PRIVACY AND THE REPOSITORY'S RULES. (1) Build: app.config.ts over app.json as EAS resolves it
(npx expo config --type prebuild), the Sentry plugin entry name and disableAutoUpload, metro.config.js with the
monorepo (does @str-ops/shared still resolve — npx expo export --platform android to a temp dir is allowed),
index.js as package.json main, version 1.1.0 vs runtimeVersion appVersion, eas.json testflight profile
(environment, channel, autoIncrement, submit profile name), expo.install.exclude, the notification icon, anything
in the diff that an OTA to the 1.0.0 build could carry. (2) Privacy: what Sentry can send (sendDefaultPii,
breadcrumbs, screenshots, IP), the push token storage, nothing from the maids' screens leaving the phone,
no third-party requests (NetInfo reachability). (3) Rules from CLAUDE.md: English in code, no raw error.message
on screen (serverErrorText), no console.log, EXPO_PUBLIC only in the bundle, i18n keys in three locales and the
section vocabulary (run apps/mobile/src/i18n/__tests__/i18n.test.ts), new readers in READERS if any fetch* was
added, a11y (roles, labels, 48 px targets, live regions, colour not alone). Run tsc and expo lint once.`,
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
          `${CONTEXT}\n\nTry to REFUTE this finding by experiment or by reading the exact lines, library source included. If it does not reproduce, or no real caller can reach it, refute it and say why. If it is real, judge the severity and the fix.\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
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
