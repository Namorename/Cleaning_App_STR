export const meta = {
  name: 'chat-layer1-preflight',
  description: 'Adversarial preflight of the chat schema migration before it is committed and pushed',
  phases: [
    { title: 'Lenses', detail: 'seven independent readings of the migration' },
    { title: 'Refute', detail: 'three skeptics per finding, each from a different angle' },
  ],
}

const CONTEXT = `
PROJECT: STR Ops — C:\\Users\\Roman\\Desktop\\Cleaning App (Supabase + Next.js manager panel + Expo cleaner app).
Read CLAUDE.md first; it states the rules this repo lives by. The feature plan is docs/chat-plan.md.

WHAT IS ABOUT TO HAPPEN: supabase/migrations/20260918120000_chat.sql is written, applied to the LOCAL
stack, and NOT yet committed or pushed. It is layer 1 of F29 (manager <-> field-staff chat): three
tables (chat_threads, chat_messages, chat_reads), one enum, one participation predicate, a tail
trigger, four RPCs, four policies, grants, and three new rows in supabase/tests/table_grants.sql.

STAKES ARE NOT A BACKFILL — NOTHING IS REWRITTEN. They are ACCESS and COST, and they are permanent:
  * The rows this feature will hold are free text and photographs written by people about flats that
    guests are staying in. A hole here leaks another company's conversation, or one cleaner's
    conversation to another.
  * The account is going multi-tenant (several client companies). Every predicate must hold with more
    than one host in the table, not merely with the single host that exists today.
  * There is no client yet. Anything wrong is cheap to fix NOW and expensive once two apps depend on it.

THE DESIGN DECISIONS YOU ARE CHECKING (from docs/chat-plan.md, approved by the owner):
  * A thread has exactly ONE subject: a task, a problem, or a member of staff (XOR check, shaped after
    task_media_one_owner in 20260908130100).
  * The pair "problem + its repair" has one subject: the PROBLEM. A maintenance task carrying
    problem_id draws the problem's thread instead of opening its own. The substitution lives only in
    open_thread.
  * The audience of a thread IS the audience of its subject — deliberately NOT narrower. Task
    visibility is wider than assignment on purpose, and a narrow thread would leave a manager's note
    on an UNCLAIMED task with no reader at all.
  * A direct thread is a COMPANY INBOX: exactly one row per (host_id, profile_id); the staff member's
    counterpart is "the office", and every manager/admin of that host reads and writes it.
  * Author name and role are DENORMALISED onto the message, because the phone cannot read anybody
    else's profiles row (the policies give it its own and nothing more).
  * chat_participates is security definer with the predicate SPELLED OUT, not delegated. The claimed
    reason: a security-invoker function called from inside a security-definer one runs as the definer
    and applies no row security. The can_read_task_media trick works only because a POLICY calls it,
    and a policy expression is evaluated as the caller. VERIFY THIS CLAIM — the whole shape rests on it.
  * Sending is reading: send_message moves the author's own read marker forward.
  * media_expected is a DECLARATION (like task_media.source), so that a photo-only message is legal
    while an empty one is not.

TOOLS: the local Supabase stack is UP and holds this exact schema with EMPTY data. Run SQL freely:
  docker exec -i supabase_db_azpvpzqkseluzbtlnlkb psql -U postgres -d postgres -c "<sql>"
To act as a user, the suites do it like this (see supabase/tests/tenant_isolation.sql):
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
ALWAYS wrap an experiment in begin; ... rollback; — the stack is shared with other agents, and a
left-behind row is somebody else's mystery. Do NOT touch the cloud. Do NOT modify repository files.

THE PRECEDENT THAT MAKES THIS WORTH DOING. On an earlier stage this same harness found a defect no
local test could: a new RPC argument defaulted to '[]' ("this booking took no rooms") and the ALREADY
DEPLOYED old Edge Function erased the links it had just backfilled. The lesson is in project memory as
"rpc-new-argument-meets-old-caller".
The counter-lesson, also recorded ("adversarial-refuters-calibration"): in that run the skeptics
reflexively refuted real findings. Refute only what the code actually contradicts, and SAY SO when a
claim survives. Earlier today a skeptic declared BLOCKING that an embed had become ambiguous; one live
query disproved it. Measure before you assert.
`

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      description: 'Only real defects. An empty array is a fine answer and is better than padding.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          where: { type: 'string', description: 'file:line or object name.' },
          what: { type: 'string', description: 'What goes wrong, concretely.' },
          how_seen: { type: 'string', description: 'The experiment or reading that shows it. Name the SQL you ran and what came back; do not paste large output.' },
          fix: { type: 'string', description: 'The smallest change that closes it.' },
        },
        required: ['title', 'severity', 'where', 'what', 'how_seen', 'fix'],
      },
    },
    verified: { type: 'array', items: { type: 'string' }, description: 'Claims you CHECKED and found sound, so a reader does not re-check them.' },
  },
  required: ['lens', 'findings', 'verified'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    better_fix: { type: 'string' },
  },
  required: ['angle', 'refuted', 'reason', 'better_fix'],
}

const LENSES = [
  {
    key: 'definer-invoker',
    prompt: `LENS: the security-definer / security-invoker claim, which the whole shape rests on.

PROVE OR DISPROVE, by experiment on the local stack, not by reasoning:
  (a) Does a \`security invoker\` function called from inside a \`security definer\` function apply row
      security as the CALLER, or as the definer? Build the minimal case: a definer function that calls
      an invoker function containing exists(select 1 from public.tasks where id = ...), then call it as
      a cleaner for a task she must not see. Report exactly what came back.
  (b) Does a POLICY expression calling a \`security invoker\` function evaluate as the caller? The repo
      relies on this at 20260907160100:203 (can_read_task_media). Confirm it.
  (c) chat_participates is \`security definer\`. Enumerate every way its answer could differ from what
      the caller is actually allowed — in particular whether auth.uid(), current_host_id(),
      is_manager(), is_active_user(), cleans_property() and task_is_beyond_horizon() all still answer
      about the CALLER when nested inside another definer. Test at least two of them.
  (d) The policy on chat_messages delegates to chat_threads with exists(). Confirm by experiment that
      a cleaner cannot read a message of a thread she cannot read, with rows actually present.`,
  },
  {
    key: 'tenant-and-audience',
    prompt: `LENS: who can read what, with MORE THAN ONE HOST in the table.

Seed two hosts, two managers, three cleaners and a technician, then attack the boundary. Every check
inside a rolled-back transaction. At minimum:
  * A cleaner of host A must not read any thread, message or read-marker of host B — task, problem or
    direct. Try it through every one of the three tables.
  * A cleaner must not read another cleaner's DIRECT thread. A manager of the same host must.
  * A deactivated cleaner (is_active = false) must read nothing at all.
  * A task beyond the horizon: its thread must be invisible to the cleaner and visible to the manager.
    Check what happens to a thread on a task whose date moves PAST the horizon after messages exist.
  * An ARCHIVED problem: the reporter loses the problem, so she must lose the thread. Confirm.
  * A problem whose fix task was reassigned: the old technician must lose the thread, the new one gain
    it, including messages written before the reassignment. Is that what happens?
  * chat_reads: a cleaner must read her own marker and no one else's; a manager reads all of her host.
    Is there any path by which a cleaner learns WHETHER a colleague has read something?`,
  },
  {
    key: 'rpc-contracts',
    prompt: `LENS: the four RPCs as contracts, exercised for real.

  * send_message idempotency: call it twice with the same p_id; the second must return the same row
    and must NOT bump message_count or last_message_at. Verify message_count after a replay.
  * send_message called with a p_id that belongs to somebody else's message: must be
    serverErrors.messageNotFound, not a leak and not a success.
  * open_thread with zero, two or three subjects: serverErrors.threadSubjectInvalid.
  * open_thread's race branch: the \`on conflict do nothing ... returning\` followed by a re-select.
    Read it carefully — is \`found\` true after an insert that conflicted? Does the function ever return
    NULL, and what would the caller see then?
  * send_message when the caller has no profiles row: the insert ... select from profiles yields no
    row. What does the function return? Is that a silent null?
  * mark_thread_read: monotonic (a late replay cannot un-read), clamped to now(), and refuses a thread
    the caller does not take part in.
  * The trigger: does message_count stay correct under a replay, under a delete, under a cascade?
  * Error keys: every raise must carry a hint starting 'serverErrors.'. Check that each key is one the
    apps could translate — compare with packages/shared/src/i18n/locales/en.json and report which keys
    are NEW and therefore still missing from the three locale files.`,
  },
  {
    key: 'subject-substitution',
    prompt: `LENS: the problem / repair substitution in open_thread, which is the feature's cleverest and
therefore most dangerous rule.

  * A maintenance task with problem_id draws the problem's thread. Confirm with rows.
  * A MANUAL maintenance task with problem_id NULL must get its own task thread. Confirm.
  * Cancel the fix task, create a second one (tasks_one_fix_per_problem allows it): does the second
    technician reach the SAME thread, with the first technician's messages in it?
  * open_thread(p_task_id) where the task's problem is one the caller may NOT read: what happens? Does
    the substitution leak the existence of a problem, or refuse cleanly?
  * open_thread(p_task_id) where the task itself is invisible to the caller: the select that reads
    t.problem_id is inside a security definer function, so it sees every row. Trace whether that
    matters.
  * A cleaning during which a problem was found (problems.task_id) keeps its OWN thread — confirm the
    two threads are distinct and neither swallows the other.
  * What happens to a thread when its task is deleted? When its problem is deleted? When the profile of
    a direct thread is deleted? Check the cascades actually do what the plan says.`,
  },
  {
    key: 'cost',
    prompt: `LENS: what this costs when the tables are not empty.

Seed a realistic-and-then-some load inside a rolled-back transaction: one host, 3 managers, 25
cleaners, 2000 tasks, 400 problems, 1500 threads, 30000 messages, 5000 read markers. Then measure:
  * A manager listing her threads ordered by last_message_at — explain analyze. Does
    chat_threads_host_idx get used, or does chat_participates turn it into a per-row function call over
    the whole table? THIS IS THE ONE I MOST EXPECT TO BE WRONG: a policy calling a definer function per
    row can be quadratic.
  * A cleaner opening one thread's messages — explain analyze on chat_messages filtered by thread_id.
  * The unread question as layer 4 will ask it: last_message_at > coalesce(last_read_at, '-infinity').
  * Report timings and plans. If a per-row predicate is the problem, say what shape fixes it — an index,
    a rewritten predicate, or a different policy — and prove the fix by measuring it.`,
  },
  {
    key: 'house-rules',
    prompt: `LENS: does this migration obey the rules this repository actually states?

Read CLAUDE.md and hold the file to it, point by point:
  * English everywhere in code, comments and error messages.
  * Every operational table carries host_id and every policy carries host_id = current_host_id().
  * Client roles get explicit grants only; anon gets nothing; the table_grants matrix names every new
    relation (check supabase/tests/table_grants.sql was actually updated, and that the privilege
    strings match what the migration grants).
  * TRUNCATE and TRIGGER must not be granted.
  * Manager-typed text that is a NAME is stored as the pair x / x_i18n — does any column here fall
    under that rule, or is message body correctly exempt? Argue it.
  * Field-written rows go through idempotent RPCs with a client-minted id. Check chat_messages.id has
    no default and that this is deliberate and consistent with problems.id.
  * Compare the shape against 20260908130000_problems.sql, which is the closest precedent in the repo,
    and report every place this migration diverges from it WITHOUT a stated reason.`,
  },
  {
    key: 'what-breaks',
    prompt: `LENS: what this migration breaks that already works.

  * A new trigger on a new table, a new enum, new grants. Enumerate everything existing that could
    change behaviour. Run the whole suite (npm run test:rls) and report anything that moved.
  * Does adding these tables change what \`supabase gen types\` produces for EXISTING tables? Run
    npm run db:types and report the diff's shape (do not paste it).
  * The tables cascade from tasks, problems and profiles. Does adding a cascade child change the cost
    or the behaviour of deleting or archiving any of those three today? Check set_property_status,
    expire_stale_tasks and the purge job.
  * Is there any path by which an EXISTING policy now returns different rows?
  * Deploy skew: the cloud will get this migration before any client knows about it. Is there anything
    here that an old client could stumble into? And the reverse — if a client shipped first, what
    would it see?`,
  },
]

phase('Lenses')

const results = await pipeline(
  LENSES,
  (l) => agent(`${CONTEXT}\n\n${l.prompt}`, { label: `lens:${l.key}`, phase: 'Lenses', schema: FINDING_SCHEMA }),
  (report, l) => {
    if (!report || !report.findings || report.findings.length === 0) {
      return { key: l.key, verified: report ? report.verified : [], confirmed: [], dropped: [] }
    }
    return parallel(
      report.findings.map((f) => () => {
        const ANGLES = [
          `Try to REFUTE this finding by experiment. Reproduce it on the local stack exactly as described in how_seen. If it does not reproduce, say so and refute. If it reproduces but is unreachable from any real caller (no policy, no RPC, no app path can get there), refute it as unreachable and say why.`,
          `Accept that the finding is real and attack the FIX instead. Does the proposed fix close it without opening something else, without breaking a house rule, and without adding a second place where a rule is written? If the fix is wrong, give the better one. Refute only if the fix would make things worse or the severity is overstated by more than one level.`,
          `Check the finding against the PLAN (docs/chat-plan.md) and the owner's stated decisions. Some of what looks like a defect is a decision: the audience being wide rather than narrow, the direct thread being a company inbox, the author name being denormalised, media_expected being a declaration. If the finding is really a disagreement with an approved decision, refute it and say which decision it argues with.`,
        ]
        return parallel(
          ANGLES.map((ask, i) => () =>
            agent(
              `${CONTEXT}\n\nYou are reviewing ONE finding from a preflight of the chat migration.\n\nANGLE ${i + 1}: ${ask}\n\nTHE FINDING:\n${JSON.stringify(f, null, 2)}`,
              { label: `refute:${l.key}:${f.severity}:${i + 1}`, phase: 'Refute', schema: VERDICT_SCHEMA },
            ),
          ),
        ).then((votes) => {
          const live = votes.filter(Boolean)
          const against = live.filter((v) => v.refuted).length
          return { finding: f, refutedBy: against, survives: against < 2, verdicts: live }
        })
      }),
    ).then((judged) => ({
      key: l.key,
      verified: report.verified || [],
      confirmed: judged.filter(Boolean).filter((j) => j.survives),
      dropped: judged.filter(Boolean).filter((j) => !j.survives),
    }))
  },
)

const out = results.filter(Boolean)
const confirmed = out.flatMap((r) => r.confirmed)
const bySeverity = (s) => confirmed.filter((c) => c.finding.severity === s).length
log(`confirmed: ${confirmed.length} (critical ${bySeverity('critical')}, high ${bySeverity('high')}, medium ${bySeverity('medium')}, low ${bySeverity('low')}); dropped ${out.flatMap((r) => r.dropped).length}`)

return out
