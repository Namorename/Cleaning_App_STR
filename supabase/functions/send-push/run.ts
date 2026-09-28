/**
 * One run of the sender (docs/f11-plan.md, «Ф — Edge Function send-push»).
 *
 * Every minute pg_cron calls the function, and the function:
 * 1. takes the groups that are due (claim_push_batch leases them);
 * 2. folds each into one push, or none, and writes it in her language;
 * 3. sends it to every phone she has — a group's messages always in one
 *    request, so a group is either sent or not;
 * 4. settles each group (record_push_results): sent with its tickets,
 *    collapsed, skipped, or failed — a failed group goes again next run;
 * 5. repeats while full batches come back, up to a bound;
 * 6. reads the receipts of what went out a quarter of an hour ago
 *    (claim_push_receipts / record_push_receipts). A phone Expo calls gone is
 *    forgotten by the database.
 *
 * Nothing here is text for a person except what texts.ts writes.
 */

import { type Batch, type PushGroup, readBatch } from "./batch.ts";
import {
  type ExpoMessage,
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
  send(messages: readonly ExpoMessage[]): Promise<ExpoTicket[]>;
  receipts(ticketIds: readonly string[]): Promise<Map<string, ExpoReceipt>>;
}

export interface RunOptions {
  readonly log: (...args: unknown[]) => void;
  readonly error: (...args: unknown[]) => void;
  readonly groupsPerBatch?: number;
  readonly maxBatches?: number;
  readonly messagesPerRequest?: number;
}

export interface RunSummary {
  batches: number;
  sent: number;
  collapsed: number;
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

/** Ticket codes that mean the project's push keys are broken, not her phone. */
const CREDENTIAL_ERRORS: ReadonlySet<string> = new Set(["InvalidCredentials", "MismatchSenderId"]);

type Outcome = "sent" | "collapsed" | "skipped" | "failed";

interface SettledTicket {
  token: string;
  status: "ok" | "error";
  ticket_id: string | null;
  error: string | null;
  message: string | null;
}

interface Settlement {
  outbox_ids: number[];
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
      return { kind: "chat_message", subject: folded.subject, id: folded.subjectId };
    case "digest":
      return { kind: "daily_digest" };
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
    // A newer push about the same cleaning or thread replaces the older one.
    collapseId: group.collapseKey,
    tag: group.collapseKey,
    threadId: group.collapseKey,
    ttl: PUSH_TTL_SECONDS,
  }));
}

function ids(group: PushGroup): number[] {
  return group.rows.map((row) => row.id);
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

async function sendAll(
  outgoing: readonly Outgoing[],
  expo: PushSender,
  options: RunOptions,
): Promise<Settlement[]> {
  const settlements: Settlement[] = [];
  for (const request of pack(outgoing, options.messagesPerRequest ?? MESSAGES_PER_REQUEST)) {
    let tickets: ExpoTicket[];
    try {
      tickets = await expo.send(request.flatMap((item) => item.messages));
    } catch (error) {
      options.error("send-push: Expo did not take the request; the groups go again", error);
      for (const item of request) {
        settlements.push({ outbox_ids: ids(item.group), outcome: "failed", tickets: [] });
      }
      continue;
    }
    let at = 0;
    for (const item of request) {
      settlements.push({
        outbox_ids: ids(item.group),
        outcome: "sent",
        tickets: item.messages.map((message, index) =>
          settleTicket(message, tickets[at + index], options)
        ),
      });
      at += item.messages.length;
    }
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

async function runBatch(
  batch: Batch,
  expo: PushSender,
  options: RunOptions,
): Promise<Settlement[]> {
  const settlements: Settlement[] = [];
  if (batch.unreadable.length > 0) {
    settlements.push({ outbox_ids: [...batch.unreadable], outcome: "skipped", tickets: [] });
  }

  const outgoing: Outgoing[] = [];
  for (const group of batch.groups) {
    const folded = fold(group);
    if (folded === null) {
      settlements.push({ outbox_ids: ids(group), outcome: "collapsed", tickets: [] });
    } else if (group.tokens.length === 0) {
      settlements.push({ outbox_ids: ids(group), outcome: "skipped", tickets: [] });
    } else {
      outgoing.push({ group, messages: messagesFor(group, folded) });
    }
  }

  return [...settlements, ...(await sendAll(outgoing, expo, options))];
}

async function readReceipts(db: PushDatabase, expo: PushSender): Promise<number> {
  const due = await call(db, "claim_push_receipts", {});
  const ticketIds = Array.isArray(due)
    ? due.filter((id): id is string => typeof id === "string")
    : [];
  if (ticketIds.length === 0) {
    return 0;
  }
  const receipts = await expo.receipts(ticketIds);
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
  const summary: RunSummary = {
    batches: 0,
    sent: 0,
    collapsed: 0,
    skipped: 0,
    failed: 0,
    receipts: 0,
  };

  for (let batchNumber = 0; batchNumber < maxBatches; batchNumber += 1) {
    const raw = await call(db, "claim_push_batch", { p_limit: groupsPerBatch });
    const handedOut = Array.isArray(raw) ? raw.length : 0;
    if (handedOut === 0) {
      break;
    }
    summary.batches += 1;

    const settlements = await runBatch(readBatch(raw), expo, options);
    await call(db, "record_push_results", { p_results: settlements });
    for (const settlement of settlements) {
      summary[settlement.outcome] += 1;
    }

    if (handedOut < groupsPerBatch) {
      break;
    }
  }

  summary.receipts = await readReceipts(db, expo);
  options.log("send-push", JSON.stringify(summary));
  return summary;
}
