/**
 * A group of queue rows — one person, one cleaning or thread — folded into
 * the one push it deserves, or into none (docs/f11-plan.md, «Свёртка»).
 *
 * The rows come in the order they were written. What matters to her is where
 * things ended up, so the order of precedence is:
 * - for the office, a cleaning a cleaner handed back (declined or interrupted,
 *   20261118120000): said, with her name;
 * - a booking cancelled while she cleans: always said;
 * - the last word is a cancellation or a taking-away: if she was given it in
 *   the same group, she never heard of it and hears nothing now; otherwise
 *   she is told;
 * - she was given it, or it is new: one such push, on the day it ended up on;
 * - it moved: one move, from where it was to where it is — nothing if that is
 *   the same place and day;
 * - its hours changed: the last hours;
 * - free work: offered as it is — unless the group also speaks of her own
 *   holding of the cleaning (given, taken, moved, its hours): then that is the
 *   news, and "free" would read as an offer of her own cleaning back.
 * A thread says how many messages came and who wrote the last. The morning
 * summary is sent as it is, and so is a new task: one row a task, written once.
 * A manager board card given to her (20261118230000) is said once, with the
 * card's and its board's titles as they are at the send — and not at all when
 * it is no longer news: the card is somebody else's by then, or nobody's, or
 * archived, deleted, or on an archived board.
 */

import type { PushGroup, PushKind, PushRow } from "./batch.ts";

export type TaskEvent = Exclude<
  PushKind,
  "chat_message" | "daily_digest" | "problem_new" | "board_card_assigned"
>;

export interface MoveFacts {
  readonly fromDate: string | null;
  readonly toDate: string | null;
  readonly fromPropertyId: string | null;
  readonly toPropertyId: string | null;
  readonly by: "office" | "booking";
}

export interface WindowFacts {
  readonly from: string | null;
  readonly to: string | null;
}

export interface FoldedTask {
  readonly type: "task";
  readonly event: TaskEvent;
  readonly taskId: string;
  /** tasks.type: a cleaning is called one, a repair or an inspection is work. */
  readonly jobType: string | null;
  readonly date: string | null;
  readonly propertyId: string | null;
  readonly urgent: boolean;
  readonly move?: MoveFacts;
  readonly window?: WindowFacts;
  /** A cleaning handed back: who, as her profile names her; never her words. */
  readonly person?: string | null;
}

export interface FoldedChat {
  readonly type: "chat";
  readonly count: number;
  readonly author: string | null;
  readonly subject: "task" | "problem";
  readonly subjectId: string;
  /** The thread itself: a repair's chat is reached through its cleaning on the phone. */
  readonly threadId: string | null;
  readonly propertyId: string | null;
}

export interface FoldedDigest {
  readonly type: "digest";
  readonly today: number;
  readonly newInWeek: number;
  /** Free cleanings of her week she may take; 0 on a row queued before the count. */
  readonly free: number;
}

/** A task reported in the company, for the head technician (20261003160000). */
export interface FoldedProblem {
  readonly type: "problem";
  readonly problemId: string;
  readonly propertyId: string | null;
  /** Who reported it, as the profile names her; never what she wrote. */
  readonly reporter: string | null;
  /** A task of high priority. */
  readonly urgent: boolean;
}

/** A manager board card given to her: what the card and its board are called now. */
export interface FoldedCard {
  readonly type: "card";
  readonly cardId: string;
  /** Null when the titles could not be read: the push then says only that a card is hers. */
  readonly card: string | null;
  readonly board: string | null;
}

export type Folded = FoldedTask | FoldedChat | FoldedDigest | FoldedProblem | FoldedCard;

const TAKEN_AWAY: ReadonlySet<PushKind> = new Set(["cleaning_cancelled", "cleaning_unassigned"]);
/** What the office hears of a cleaning a cleaner handed back (20261118120000). */
const HANDED_BACK: ReadonlySet<PushKind> = new Set(["cleaning_declined", "cleaning_interrupted"]);
const GIVEN: ReadonlySet<PushKind> = new Set(["cleaning_new", "cleaning_assigned"]);

function text(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** "10:00:00" as Postgres writes a time, "10:00" as she reads it. */
function clock(value: unknown): string | null {
  const time = text(value);
  return time === null ? null : time.slice(0, 5);
}

/** The day a row leaves the cleaning on. */
function dayAfter(row: PushRow): string | null {
  return row.kind === "cleaning_moved" ? text(row.params.to_date) : text(row.params.date);
}

function taskPush(
  rows: readonly PushRow[],
  event: TaskEvent,
  date: string | null,
  extra: Pick<FoldedTask, "move" | "window"> = {},
): FoldedTask {
  const last = rows[rows.length - 1];
  return {
    type: "task",
    event,
    taskId: last.taskId ?? "",
    jobType: text(last.params.type),
    date,
    propertyId: last.propertyId,
    urgent: rows.some((row) => row.urgent),
    ...extra,
  };
}

function lastOf(rows: readonly PushRow[], kind: PushKind): PushRow | undefined {
  return [...rows].reverse().find((row) => row.kind === kind);
}

function foldMoves(rows: readonly PushRow[]): FoldedTask | null {
  const moves = rows.filter((row) => row.kind === "cleaning_moved");
  const first = moves[0];
  const last = moves[moves.length - 1];
  const move: MoveFacts = {
    fromDate: text(first.params.from_date),
    toDate: text(last.params.to_date),
    fromPropertyId: text(first.params.from_property),
    toPropertyId: text(last.params.to_property),
    by: last.params.by === "office" ? "office" : "booking",
  };
  if (move.fromDate === move.toDate && move.fromPropertyId === move.toPropertyId) {
    return null;
  }
  return taskPush(rows, "cleaning_moved", move.toDate, { move });
}

function foldWindow(rows: readonly PushRow[], row: PushRow): FoldedTask {
  return taskPush(rows, "cleaning_window", text(row.params.date), {
    window: { from: clock(row.params.time_from), to: clock(row.params.time_to) },
  });
}

/**
 * The office told that a cleaner handed a cleaning back: the last word, with her name. A manager
 * linked to the listing may also be offered it as free work in the same group; the hand-back is
 * the news (20261118120000).
 */
function foldHandBack(rows: readonly PushRow[]): FoldedTask | null {
  const last = [...rows].reverse().find((row) => HANDED_BACK.has(row.kind));
  if (last === undefined) {
    return null;
  }
  return {
    ...taskPush([last], last.kind as TaskEvent, text(last.params.date)),
    urgent: rows.some((row) => HANDED_BACK.has(row.kind) && row.urgent),
    person: text(last.params.by_name),
  };
}

function foldTask(rows: readonly PushRow[]): FoldedTask | null {
  const handedBack = foldHandBack(rows);
  if (handedBack !== null) {
    return handedBack;
  }
  const own = rows.filter((row) => row.kind !== "cleaning_free");
  if (own.length > 0 && own.length < rows.length) {
    return foldTask(own);
  }
  const has = (kinds: ReadonlySet<PushKind> | PushKind) =>
    rows.some((row) => (typeof kinds === "string" ? row.kind === kinds : kinds.has(row.kind)));
  const last = rows[rows.length - 1];

  const cancelledLive = lastOf(rows, "booking_cancelled_live");
  if (cancelledLive !== undefined) {
    return taskPush(rows, "booking_cancelled_live", text(cancelledLive.params.date));
  }

  if (TAKEN_AWAY.has(last.kind)) {
    return has(GIVEN) ? null : taskPush(rows, last.kind as TaskEvent, text(last.params.date));
  }

  const given = rows.find((row) => GIVEN.has(row.kind));
  if (given !== undefined) {
    const finalDay = rows.reduce<string | null>((day, row) => dayAfter(row) ?? day, null);
    return taskPush(rows, given.kind as TaskEvent, finalDay);
  }

  if (has("cleaning_moved")) {
    const moved = foldMoves(rows);
    if (moved !== null) {
      return moved;
    }
  }

  const window = lastOf(rows, "cleaning_window");
  if (window !== undefined) {
    return foldWindow(rows, window);
  }

  const free = lastOf(rows, "cleaning_free");
  return free === undefined ? null : taskPush(rows, "cleaning_free", text(free.params.date));
}

function foldChat(rows: readonly PushRow[]): FoldedChat | null {
  const last = rows[rows.length - 1];
  const subject = last.params.subject === "problem" ? "problem" : "task";
  const subjectId = text(subject === "problem" ? last.params.problem_id : last.params.task_id);
  if (subjectId === null) {
    return null;
  }
  return {
    type: "chat",
    count: rows.length,
    author: text(last.params.author_name),
    subject,
    subjectId,
    threadId: last.threadId,
    propertyId: last.propertyId,
  };
}

function foldProblem(rows: readonly PushRow[]): FoldedProblem | null {
  const last = rows[rows.length - 1];
  const problemId = text(last.params.problem_id);
  if (problemId === null) {
    return null;
  }
  return {
    type: "problem",
    problemId,
    propertyId: last.propertyId,
    reporter: text(last.params.reporter_name),
    urgent: rows.some((row) => row.urgent),
  };
}

function foldCard(group: PushGroup, rows: readonly PushRow[]): FoldedCard | null {
  const cardId = text(rows[rows.length - 1].params.card_id);
  if (cardId === null) {
    return null;
  }
  if (group.cards === undefined) {
    // Not read: the run sets such a group aside before it folds; without it, said bare.
    return { type: "card", cardId, card: null, board: null };
  }
  const titles = group.cards.get(cardId);
  if (titles === undefined || !titles.isLive || titles.assigneeId !== group.recipientId) {
    return null;
  }
  return { type: "card", cardId, card: titles.card, board: titles.board };
}

export function fold(group: PushGroup): Folded | null {
  const rows = group.rows;
  const last = rows[rows.length - 1];
  if (last === undefined) {
    return null;
  }
  if (last.kind === "chat_message") {
    return foldChat(rows.filter((row) => row.kind === "chat_message"));
  }
  if (last.kind === "board_card_assigned") {
    return foldCard(group, rows.filter((row) => row.kind === "board_card_assigned"));
  }
  if (last.kind === "problem_new") {
    return foldProblem(rows.filter((row) => row.kind === "problem_new"));
  }
  if (last.kind === "daily_digest") {
    return {
      type: "digest",
      today: count(last.params.today),
      newInWeek: count(last.params.new_in_week),
      free: count(last.params.free),
    };
  }
  return foldTask(rows);
}
