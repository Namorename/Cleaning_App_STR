/**
 * What a request may say, read strictly.
 *
 * An unknown query parameter or body field is refused rather than ignored: a
 * script or an agent that misspells a filter would otherwise get every row and
 * never learn why. Each value is checked for its form only; what it means
 * (does the person exist, is the day free) is the database's to say.
 */

import type { FieldError } from "./problem.ts";

export type ParamKind =
  | "uuid"
  | "id"
  | "date"
  | "datetime"
  | "boolean"
  | "limit"
  | "time"
  | "text";

export interface ParamSpec {
  /** The name on the wire: a query parameter, a path segment or a body field. */
  readonly name: string;
  /** The RPC argument it becomes. */
  readonly arg: string;
  readonly kind: ParamKind;
  /** Allowed values; with `list`, a comma-separated set of them. */
  readonly enum?: readonly string[];
  readonly list?: boolean;
  readonly required?: boolean;
  /** A body field that may be sent as null (the field must still be sent when required). */
  readonly nullable?: boolean;
  readonly maxLength?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[1-9][0-9]{0,15}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LIST_ITEM = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_LIST = 20;

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) {
    return false;
  }
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d);
}

export type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function bad(message: string): Parsed {
  return { ok: false, message };
}

/** One scalar from the query string or the path, as text. */
function parseText(spec: ParamSpec, raw: string): Parsed {
  switch (spec.kind) {
    case "uuid":
      return UUID.test(raw) ? { ok: true, value: raw.toLowerCase() } : bad("must be a UUID");
    case "id":
      return ID.test(raw) ? { ok: true, value: Number(raw) } : bad("must be a positive integer id");
    case "date":
      return isCalendarDate(raw) ? { ok: true, value: raw } : bad("must be a date, YYYY-MM-DD");
    case "datetime":
      return DATETIME.test(raw) && !Number.isNaN(Date.parse(raw))
        ? { ok: true, value: raw }
        : bad("must be an ISO 8601 timestamp with a zone, e.g. 2026-10-28T09:15:00Z");
    case "boolean":
      return raw === "true" || raw === "false" ? { ok: true, value: raw === "true" } : bad("must be true or false");
    case "limit": {
      const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
      return n >= 1 && n <= MAX_LIMIT ? { ok: true, value: n } : bad(`must be an integer from 1 to ${MAX_LIMIT}`);
    }
    case "time":
      return TIME.test(raw) ? { ok: true, value: raw } : bad("must be a time, HH:MM");
    case "text":
      if (spec.enum !== undefined) {
        return spec.enum.includes(raw) ? { ok: true, value: raw } : bad(`must be one of ${spec.enum.join(", ")}`);
      }
      return raw.length >= 1 && raw.length <= (spec.maxLength ?? 200)
        ? { ok: true, value: raw }
        : bad(`must be 1 to ${spec.maxLength ?? 200} characters`);
  }
}

function parseList(spec: ParamSpec, raw: string): Parsed {
  const items = [...new Set(raw.split(",").map((item) => item.trim()).filter((item) => item !== ""))];
  if (items.length === 0 || items.length > MAX_LIST) {
    return bad(`must list 1 to ${MAX_LIST} values separated by commas`);
  }
  for (const item of items) {
    if (spec.enum !== undefined ? !spec.enum.includes(item) : !LIST_ITEM.test(item)) {
      return bad(spec.enum !== undefined ? `values must be among ${spec.enum.join(", ")}` : "has a value that is not a plain word");
    }
  }
  return { ok: true, value: items };
}

export interface ParsedParams {
  readonly args: Record<string, unknown>;
  /** By wire name: what the filters were, for the cursor's fingerprint. */
  readonly values: Record<string, unknown>;
  readonly errors: FieldError[];
}

/** Path segments and the query string. `reserved` names (cursor, limit) are read elsewhere. */
export function parseQuery(
  specs: readonly ParamSpec[],
  pathValues: Readonly<Record<string, string>>,
  query: URLSearchParams,
  reserved: readonly string[],
): ParsedParams {
  const args: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};
  const errors: FieldError[] = [];
  const known = new Set([...specs.map((spec) => spec.name), ...reserved]);

  for (const name of new Set(query.keys())) {
    if (!known.has(name)) {
      errors.push({ name, message: "is not a parameter of this operation" });
    } else if (query.getAll(name).length > 1) {
      errors.push({ name, message: "is given more than once" });
    }
  }

  for (const spec of specs) {
    const raw = pathValues[spec.name] ?? query.get(spec.name);
    if (raw === null || raw === undefined || raw === "") {
      if (spec.required) {
        errors.push({ name: spec.name, message: "is required" });
      }
      continue;
    }
    const parsed = spec.list ? parseList(spec, raw) : parseText(spec, raw);
    if (parsed.ok) {
      args[spec.arg] = parsed.value;
      values[spec.name] = parsed.value;
    } else {
      errors.push({ name: spec.name, message: parsed.message });
    }
  }
  return { args, values, errors };
}

/** A JSON body: an object, only the fields the operation knows. */
export function parseBody(specs: readonly ParamSpec[], body: unknown): ParsedParams {
  const args: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { args, values, errors: [{ name: "body", message: "must be a JSON object" }] };
  }
  const record = body as Record<string, unknown>;
  const known = new Set(specs.map((spec) => spec.name));
  for (const name of Object.keys(record)) {
    if (!known.has(name)) {
      errors.push({ name, message: "is not a field of this operation" });
    }
  }

  for (const spec of specs) {
    if (!(spec.name in record)) {
      if (spec.required) {
        errors.push({ name: spec.name, message: "is required" });
      }
      continue;
    }
    const value = record[spec.name];
    if (value === null) {
      if (spec.nullable) {
        args[spec.arg] = null;
        values[spec.name] = null;
      } else {
        errors.push({ name: spec.name, message: "must not be null" });
      }
      continue;
    }
    const raw = spec.kind === "id" && typeof value === "number" && Number.isInteger(value)
      ? String(value)
      : value;
    if (typeof raw !== "string") {
      errors.push({ name: spec.name, message: spec.kind === "id" ? "must be an integer id" : "must be a string" });
      continue;
    }
    const parsed = parseText(spec, raw);
    if (parsed.ok) {
      args[spec.arg] = parsed.value;
      values[spec.name] = parsed.value;
    } else {
      errors.push({ name: spec.name, message: parsed.message });
    }
  }
  return { args, values, errors };
}

/** One value of a given kind, outside any operation: a cursor's halves, `limit`. */
export function checkScalar(kind: ParamKind, raw: string): Parsed {
  return parseText({ name: "", arg: "", kind }, raw);
}
