/**
 * One run of the sender (docs/f11-plan.md, «Ф — Edge Function send-push»).
 *
 * Every minute pg_cron calls the function, and the function:
 * 1. takes the groups that are due (claim_push_batch leases them);
 * 2. folds each into one push, or none, and writes it in her language;
 * 3. sends it to every phone she has — a group's messages always in one
 *    request, so a group is either sent or not (unless Expo refuses a request
 *    that mixes Expo projects: then each project's messages go apart);
 * 4. settles each group (record_push_results): sent with its tickets,
 *    collapsed, skipped, or failed — a failed group goes again next run;
 * 5. repeats while full batches come back, up to a bound — and only while a
 *    batch can still finish inside its lease: a group not sent in time is let
 *    go under its own lease for the next run;
 * 6. reads the receipts of what went out a quarter of an hour ago
 *    (claim_push_receipts / record_push_receipts). A phone Expo calls gone is
 *    forgotten by the database.
 *
 * Nothing here is text for a person except what texts.ts writes.
 */

import { type Batch, type PushGroup, type PushKind, readBatch } from "./batch.ts";
import {
  type ExpoMessage,
  ExpoMixedProjectsError,
  type ExpoReceipt,
  type ExpoTicket,
  MESSAGES_PER_REQUEST,
} from "./expo.ts";
import { type Folded, fold } from "./fold.ts";
import { renderPush } from "./texts.ts";

/** The part of the Supabase client the run uses; replaced in tests. */
export interface PushDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** The part of the Expo client the run uses; replaced in tests. */
export interface PushSender {
  send(messages: readonly ExpoMessage[], deadline?: number): Promise<ExpoTicket[]>;
  receipts(ticketIds: readonly string[]): Promise<Map<string, ExpoReceipt>>;
}

export interface RunOptions {
  readonly log: (...args: unknown[]) => void;
  readonly error: (...args: unknown[]) => void;
  readonly groupsPerBatch?: number;
  readonly maxBatches?: number;
  readonly messagesPerRequest?: number;
  /** The clock, in ms; replaced in tests. */
  readonly now?: () => number;
}

export interface RunSummary {
  batches: number;
  sent: number;
  collapsed: number;
  muted: number;
  skipped: number;
  failed: number;
  receipts: number;
}

/** Groups a run of the minute hands out, at most 5 batches of them (500 pushes). */
const GROUPS_PER_BATCH = 100;
const MAX_BATCHES = 5;

/**
 * How long Expo and the phone's platform keep trying a phone that is off:
 * news of a job is still worth having hours later, not the next day.
 */
const PUSH_TTL_SECONDS = 6 * 60 * 60;

/**
 * How long a batch may take from its claim: the lease (push_lease, two
 * minutes) less a margin, so a group is never sent after its lease ran out
 * and the next run took it.
 */
const BATCH_BUDGET_MS = 90_000;

/** No new batch is claimed after this much of the run: the next minute's run takes it. */
const RUN_BUDGET_MS = 45_000;

/** Ticket and receipt codes that mean the project's push keys are broken, not her phone. */
const CREDENTIAL_ERRORS: ReadonlySet<string> = new Set(["InvalidCredentials", "MismatchSenderId"]);

type Outcome = "sent" | "collapsed" | "muted" | "skipped" | "failed";

interface SettledTicket {
  token: string;
  status: "ok" | "error";
  ticket_id: string | null;
  error: string | null;
  message: string | null;
}

interface Settlement {
  outbox_ids: number[];
  lease?: string;
  outcome: Outcome;
  tickets: SettledTicket[];
}

interface Outgoing {
  readonly group: PushGroup;
  readonly messages: ExpoMessage[];
}

/** What the phone gets to decide where a tap leads: never text. */
function pushData(folded: Folded): Record<string, unknown> {
  switch (folded.type) {
    case "task":
      return { kind: folded.event, taskId: folded.taskId };
    case "chat":
      // The thread's own id too: the phone tells the thread on screen by it.
      return {
        kind: "chat_message",
        subject: folded.subject,
        id: folded.subjectId,
        threadId: folded.threadId,
      };
    case "digest":
      return { kind: "daily_digest" };
  }
}

/** The kind a folded push is, as she switches it off in the settings. */
function kindOf(folded: Folded): PushKind {
  switch (folded.type) {
    case "task":
      return folded.event;
    case "chat":
      return "chat_message";
    case "digest":
      return "daily_digest";
  }
}

function messagesFor(group: PushGroup, folded: Folded): ExpoMessage[] {
  const { title, body } = renderPush(folded, group);
  const urgent = folded.type === "task" && folded.urgent;
  return group.tokens.map((phone) => ({
    to: phone.token,
    title,
    body,
    data: pushData(folded),
    sound: "default",
    priority: "high",
    channelId: urgent ? "urgent" : "general",
    interruptionLevel: urgent ? "time-sensitive" : "active",
    // A newer push about the same cleaning or thread replaces the older one:
    // collapseId on an iPhone, tag on Android. Not collapseId on Android — it
    // becomes FCM's collapse key, and FCM keeps four of those for a phone that
    // is off, dropping the rest.
    ...(phone.platform === "ios" ? { collapseId: group.collapseKey } : {}),
    tag: group.collapseKey,
    threadId: group.collapseKey,
    ttl: PUSH_TTL_SECONDS,
  }));
}

function ids(group: PushGroup): number[] {
  return group.rows.map((row) => row.id);
}

/** A group's settlement, under the lease it was handed out with. */
function settlement(
  group: PushGroup,
  outcome: Outcome,
  tickets: SettledTicket[] = [],
): Settlement {
  return {
    outbox_ids: ids(group),
    ...(group.lease === null ? {} : { lease: group.lease }),
    outcome,
    tickets,
  };
}

/** Pack whole groups into requests of at most `size` messages. */
function pack(outgoing: readonly Outgoing[], size: number): Outgoing[][] {
  const requests: Outgoing[][] = [];
  let current: Outgoing[] = [];
  let count = 0;
  for (const item of outgoing) {
    if (count > 0 && count + item.messages.length > size) {
      requests.push(current);
      current = [];
      count = 0;
    }
    current.push(item);
    count += item.messages.length;
  }
  if (current.length > 0) {
    requests.push(current);
  }
  return requests;
}

function settleTicket(message: ExpoMessage, ticket: ExpoTicket, options: RunOptions): SettledTicket {
  if (ticket.status === "ok") {
    return { token: message.to, status: "ok", ticket_id: ticket.id, error: null, message: null };
  }
  const code = ticket.details?.error ?? null;
  if (code !== null && CREDENTIAL_ERRORS.has(code)) {
    options.error(`send-push: ${code} — the project's push keys are broken`, ticket.message);
  }
  return {
    token: message.to,
    status: "error",
    ticket_id: null,
    error: code,
    message: ticket.message ?? null,
  };
}

/** A message no request took, in a group that cannot go again. */
function lostTicket(error: unknown): ExpoTicket {
  return {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    details: { error: "RequestFailed" },
  };
}

/**
 * Expo refused a request holding phones of more than one Expo project — a
 * development build registered beside the app, say. One such phone must not
 * silence everybody packed with it: each project's messages go in a request of
 * their own, phones Expo did not name in one more. A group wholly in a part
 * that fails goes again next run, like any failed group; a group split across
 * parts is settled with what reached her, since going again would repeat the
 * push on the phones it already reached.
 */
async function sendByProject(
  request: readonly Outgoing[],
  refusal: ExpoMixedProjectsError,
  expo: PushSender,
  options: RunOptions,
  deadline: number,
): Promise<Settlement[]> {
  const { projects, names } = refusal;
  const projectOf = new Map<string, number>();
  projects.forEach((tokens, index) => tokens.forEach((token) => projectOf.set(token, index)));
  const nameOf = (index: number): string => names[index] ?? "(not named by Expo)";

  const parts = new Map<number, ExpoMessage[]>();
  for (const message of request.flatMap((item) => item.messages)) {
    const index = projectOf.get(message.to) ?? projects.length;
    parts.set(index, [...(parts.get(index) ?? []), message]);
  }
  // Which project is the stray one, and how many of this request's phones each
  // holds: the owner removes the stray phone by it. Never a token, and not
  // Expo's own text either — it is not ours to vouch for.
  // Phones, not messages: one phone may carry several pushes in a request.
  const perProject = [...parts.entries()].map(
    ([index, part]) => `${nameOf(index)} ${new Set(part.map((message) => message.to)).size}`,
  );
  options.log(
    "send-push: Expo refused a request mixing Expo projects (PUSH_TOO_MANY_EXPERIENCE_IDS); " +
      `sent apart, phones per project: ${perProject.join(", ")}`,
  );

  // A message's ticket, or the reason its part's request failed.
  const tickets = new Map<ExpoMessage, ExpoTicket>();
  const failures = new Map<ExpoMessage, unknown>();
  for (const [index, part] of parts.entries()) {
    try {
      const answer = await expo.send(part, deadline);
      part.forEach((message, at) => tickets.set(message, answer[at]));
    } catch (error) {
      options.error(`send-push: the request for Expo project ${nameOf(index)} failed`, error);
      part.forEach((message) => failures.set(message, error));
    }
  }

  return request.map((item) => {
    if (item.messages.every((message) => failures.has(message))) {
      return settlement(item.group, "failed");
    }
    return settlement(
      item.group,
      "sent",
      item.messages.map((message) =>
        settleTicket(message, tickets.get(message) ?? lostTicket(failures.get(message)), options)
      ),
    );
  });
}

async function sendAll(
  outgoing: readonly Outgoing[],
  expo: PushSender,
  options: RunOptions,
  deadline: number,
): Promise<Settlement[]> {
  const now = options.now ?? Date.now;
  const settlements: Settlement[] = [];
  let outOfTime = false;
  for (const request of pack(outgoing, options.messagesPerRequest ?? MESSAGES_PER_REQUEST)) {
    if (outOfTime || now() >= deadline) {
      // Past the lease a group may already be another run's: let it go.
      outOfTime = true;
      for (const item of request) {
        settlements.push(settlement(item.group, "failed"));
      }
      continue;
    }
    let tickets: ExpoTicket[];
    try {
      tickets = await expo.send(request.flatMap((item) => item.messages), deadline);
    } catch (error) {
      if (error instanceof ExpoMixedProjectsError) {
        settlements.push(...(await sendByProject(request, error, expo, options, deadline)));
        continue;
      }
      options.error("send-push: Expo did not take the request; the groups go again", error);
      for (const item of request) {
        settlements.push(settlement(item.group, "failed"));
      }
      continue;
    }
    let at = 0;
    for (const item of request) {
      settlements.push(
        settlement(
          item.group,
          "sent",
          item.messages.map((message, index) => settleTicket(message, tickets[at + index], options)),
        ),
      );
      at += item.messages.length;
    }
  }
  if (outOfTime) {
    options.error("send-push: the batch ran out of time; the rest goes in the next run");
  }
  return settlements;
}

async function call(
  db: PushDatabase,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await db.rpc(name, args);
  if (error !== null) {
    throw new Error(`${name}: ${error.message}`);
  }
  return data;
}

/**
 * What one group comes to: a push, or a settlement without one. The fold
 * decides first and the kinds she switched off are judged on what it decided
 * — muting half of "given, then taken away" must not send the other half.
 * A group that cannot be written (params the text cannot read) is set aside
 * and reported; the rest of the batch goes on.
 */
function prepare(group: PushGroup, options: RunOptions): Outgoing | Settlement {
  try {
    const folded = fold(group);
    if (folded === null) {
      return settlement(group, "collapsed");
    }
    if (group.muted.has(kindOf(folded))) {
      return settlement(group, "muted");
    }
    if (group.tokens.length === 0) {
      return settlement(group, "skipped");
    }
    return { group, messages: messagesFor(group, folded) };
  } catch (error) {
    options.error(`send-push: ${group.collapseKey} could not be written; set aside`, error);
    return settlement(group, "skipped");
  }
}

async function runBatch(
  batch: Batch,
  expo: PushSender,
  options: RunOptions,
  deadline: number,
): Promise<Settlement[]> {
  const settlements: Settlement[] = [];
  if (batch.unreadable.length > 0) {
    settlements.push({ outbox_ids: [...batch.unreadable], outcome: "skipped", tickets: [] });
  }

  const outgoing: Outgoing[] = [];
  for (const group of batch.groups) {
    const prepared = prepare(group, options);
    if ("messages" in prepared) {
      outgoing.push(prepared);
    } else {
      settlements.push(prepared);
    }
  }

  return [...settlements, ...(await sendAll(outgoing, expo, options, deadline))];
}

/** Receipt codes that mean the project's keys are broken: said once a run, with how many. */
function reportBrokenKeys(receipts: ReadonlyMap<string, ExpoReceipt>, options: RunOptions): void {
  const counts = new Map<string, number>();
  for (const receipt of receipts.values()) {
    const code = receipt.details?.error;
    if (code !== undefined && CREDENTIAL_ERRORS.has(code)) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  for (const [code, count] of counts) {
    options.error(`send-push: ${code} in ${count} receipt(s) — the project's push keys are broken`);
  }
}

async function readReceipts(
  db: PushDatabase,
  expo: PushSender,
  options: RunOptions,
): Promise<number> {
  const due = await call(db, "claim_push_receipts", {});
  const ticketIds = Array.isArray(due)
    ? due.filter((id): id is string => typeof id === "string")
    : [];
  if (ticketIds.length === 0) {
    return 0;
  }
  const receipts = await expo.receipts(ticketIds);
  reportBrokenKeys(receipts, options);
  const answered = [...receipts.entries()].map(([ticketId, receipt]) => ({
    ticket_id: ticketId,
    status: receipt.status,
    error: receipt.details?.error ?? null,
    message: receipt.message ?? null,
  }));
  if (answered.length > 0) {
    await call(db, "record_push_receipts", { p_receipts: answered });
  }
  return answered.length;
}

export async function runSendPush(
  db: PushDatabase,
  expo: PushSender,
  options: RunOptions,
): Promise<RunSummary> {
  const groupsPerBatch = options.groupsPerBatch ?? GROUPS_PER_BATCH;
  const maxBatches = options.maxBatches ?? MAX_BATCHES;
  const now = options.now ?? Date.now;
  const runStarted = now();
  const summary: RunSummary = {
    batches: 0,
    sent: 0,
    collapsed: 0,
    muted: 0,
    skipped: 0,
    failed: 0,
    receipts: 0,
  };

  for (let batchNumber = 0; batchNumber < maxBatches; batchNumber += 1) {
    if (batchNumber > 0 && now() - runStarted >= RUN_BUDGET_MS) {
      break;
    }
    const raw = await call(db, "claim_push_batch", { p_limit: groupsPerBatch });
    const deadline = now() + BATCH_BUDGET_MS;
    const handedOut = Array.isArray(raw) ? raw.length : 0;
    if (handedOut === 0) {
      break;
    }
    summary.batches += 1;

    const settlements = await runBatch(readBatch(raw), expo, options, deadline);
    await call(db, "record_push_results", { p_results: settlements });
    for (const settlement of settlements) {
      summary[settlement.outcome] += 1;
    }

    if (handedOut < groupsPerBatch) {
      break;
    }
  }

  summary.receipts = await readReceipts(db, expo, options);
  options.log("send-push", JSON.stringify(summary));
  return summary;
}
