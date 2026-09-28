/**
 * What claim_push_batch hands out, read like outside input.
 *
 * The RPC is ours, but the function and the migration are deployed apart: a
 * kind of event added to the database after this function was deployed must
 * not stop the run. A row this build cannot read is set aside — settled as
 * skipped — and the rest of its group goes on.
 */

import { isRecord } from "../_shared/coerce.ts";

/** push_kind, in the order the migration declares it (20260928100000). */
export const PUSH_KINDS = [
  "cleaning_new",
  "cleaning_assigned",
  "cleaning_unassigned",
  "cleaning_cancelled",
  "cleaning_moved",
  "cleaning_window",
  "cleaning_free",
  "booking_cancelled_live",
  "chat_message",
  "daily_digest",
] as const;

export type PushKind = (typeof PUSH_KINDS)[number];

export const LANGUAGES = ["ru", "en", "cs"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface PushRow {
  readonly id: number;
  readonly kind: PushKind;
  readonly taskId: string | null;
  readonly threadId: string | null;
  /** The flat the row is about: the cleaning's own, or the report's. */
  readonly propertyId: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly urgent: boolean;
}

export interface Place {
  readonly name: string;
  readonly hostawayUnitId: number | null;
  readonly parentName: string | null;
}

export interface PushToken {
  readonly token: string;
  readonly platform: "ios" | "android";
}

export interface PushGroup {
  readonly recipientId: string;
  readonly collapseKey: string;
  readonly language: Language;
  readonly tokens: readonly PushToken[];
  /** Keyed by property id as text. */
  readonly places: ReadonlyMap<string, Place>;
  readonly rows: readonly PushRow[];
}

export interface Batch {
  readonly groups: readonly PushGroup[];
  /** Rows this build cannot read: settled as skipped, never sent. */
  readonly unreadable: readonly number[];
}

function isPushKind(value: unknown): value is PushKind {
  return typeof value === "string" && (PUSH_KINDS as readonly string[]).includes(value);
}

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function readRow(raw: unknown): PushRow | null {
  if (!isRecord(raw) || typeof raw.id !== "number" || !isPushKind(raw.kind)) {
    return null;
  }
  return {
    id: raw.id,
    kind: raw.kind,
    taskId: textOrNull(raw.task_id),
    threadId: textOrNull(raw.thread_id),
    propertyId: textOrNull(raw.property_id),
    params: isRecord(raw.params) ? raw.params : {},
    urgent: raw.urgent === true,
  };
}

function readPlaces(raw: unknown): Map<string, Place> {
  const places = new Map<string, Place>();
  if (!isRecord(raw)) {
    return places;
  }
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.name !== "string") {
      continue;
    }
    const parent = isRecord(value.parent) && typeof value.parent.name === "string"
      ? value.parent.name
      : null;
    places.set(id, {
      name: value.name,
      hostawayUnitId: typeof value.hostaway_unit_id === "number" ? value.hostaway_unit_id : null,
      parentName: parent,
    });
  }
  return places;
}

function readTokens(raw: unknown): PushToken[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((value) =>
    isRecord(value) && typeof value.token === "string" &&
      (value.platform === "ios" || value.platform === "android")
      ? [{ token: value.token, platform: value.platform }]
      : []
  );
}

/** Every row id in a group, readable or not: what to settle when the group cannot be read. */
function rowIds(raw: unknown): number[] {
  return Array.isArray(raw)
    ? raw.flatMap((value) => isRecord(value) && typeof value.id === "number" ? [value.id] : [])
    : [];
}

export function readBatch(raw: unknown): Batch {
  const groups: PushGroup[] = [];
  const unreadable: number[] = [];

  for (const value of Array.isArray(raw) ? raw : []) {
    if (
      !isRecord(value) || typeof value.recipient_id !== "string" ||
      typeof value.collapse_key !== "string" || !Array.isArray(value.rows)
    ) {
      unreadable.push(...rowIds(isRecord(value) ? value.rows : null));
      continue;
    }

    const rows: PushRow[] = [];
    for (const rawRow of value.rows) {
      const row = readRow(rawRow);
      if (row === null) {
        unreadable.push(...rowIds([rawRow]));
      } else {
        rows.push(row);
      }
    }
    if (rows.length === 0) {
      continue;
    }

    groups.push({
      recipientId: value.recipient_id,
      collapseKey: value.collapse_key,
      // The server always answers with one of the three; Russian is the
      // company's first language should it ever not.
      language: isLanguage(value.language) ? value.language : "ru",
      tokens: readTokens(value.tokens),
      places: readPlaces(value.places),
      rows,
    });
  }

  return { groups, unreadable };
}
