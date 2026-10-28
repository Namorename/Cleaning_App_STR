/**
 * Errors of the public API as RFC 9457 problem details (docs/api-v1.md §7).
 *
 * `type` is a URN, not a link: the panel's address will change, the codes will
 * not. `code` repeats its tail for clients that would rather switch on a
 * string. Nothing a database said in prose leaves the function: a refusal of
 * the panel's own functions travels as its stable key (`reason`) and its
 * parameters (`params`), exactly what the panel translates.
 */

export type ProblemCode =
  | "invalid-request"
  | "invalid-cursor"
  | "key-in-url"
  | "idempotency-key-required"
  | "missing-key"
  | "invalid-key"
  | "key-expired"
  | "key-revoked"
  | "key-suspended"
  | "insufficient-scope"
  | "property-not-allowed"
  | "forbidden"
  | "not-found"
  | "method-not-allowed"
  | "conflict"
  | "payload-too-large"
  | "unsupported-media-type"
  | "rejected"
  | "idempotency-key-reused"
  | "rate-limited"
  | "internal";

interface ProblemShape {
  readonly status: number;
  readonly title: string;
}

export const PROBLEMS: Readonly<Record<ProblemCode, ProblemShape>> = {
  "invalid-request": { status: 400, title: "The request is not valid" },
  "invalid-cursor": { status: 400, title: "The cursor is not valid for this request" },
  "key-in-url": { status: 400, title: "An API key must not be sent in the URL" },
  "idempotency-key-required": { status: 400, title: "This request needs an Idempotency-Key header" },
  "missing-key": { status: 401, title: "No API key was sent" },
  "invalid-key": { status: 401, title: "The API key is not valid" },
  "key-expired": { status: 401, title: "The API key has expired" },
  "key-revoked": { status: 401, title: "The API key has been revoked" },
  "key-suspended": {
    status: 401,
    title: "The API key is suspended: the admin who made it is no longer an active admin",
  },
  "insufficient-scope": { status: 403, title: "The key lacks the scope this operation needs" },
  "property-not-allowed": { status: 403, title: "The key may not act on this property" },
  "forbidden": { status: 403, title: "The operation is not allowed" },
  "not-found": { status: 404, title: "Not found" },
  "method-not-allowed": { status: 405, title: "The method is not allowed on this path" },
  "conflict": { status: 409, title: "The object's state does not allow this" },
  "payload-too-large": { status: 413, title: "The request body is too large" },
  "unsupported-media-type": { status: 415, title: "The request body must be application/json" },
  "rejected": { status: 422, title: "The request breaks a business rule" },
  "idempotency-key-reused": {
    status: 422,
    title: "The Idempotency-Key was already used with another request",
  },
  "rate-limited": { status: 429, title: "Too many requests" },
  "internal": { status: 500, title: "Something went wrong on our side" },
};

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail?: string;
  readonly request_id?: string;
  readonly required_scope?: string;
  readonly reason?: string;
  readonly params?: Record<string, unknown>;
  readonly errors?: readonly FieldError[];
}

export interface FieldError {
  readonly name: string;
  readonly message: string;
}

export interface ProblemExtras {
  readonly detail?: string;
  readonly required_scope?: string;
  readonly reason?: string;
  readonly params?: Record<string, unknown>;
  readonly errors?: readonly FieldError[];
}

/** A problem the handler answers with; thrown and caught at the top. */
export class ApiProblem extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly extras: ProblemExtras = {},
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "ApiProblem";
  }

  get status(): number {
    return PROBLEMS[this.code].status;
  }

  body(requestId: string): ProblemBody {
    return {
      type: `urn:woom:problem:${this.code}`,
      title: PROBLEMS[this.code].title,
      status: this.status,
      code: this.code,
      ...this.extras,
      request_id: requestId,
    };
  }
}

/** A failed database call, as supabase-js hands it over. */
export interface RpcError {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
  readonly hint?: string | null;
}

const API_HINT = "api:";
const SERVER_ERROR_KEY = "serverErrors.";

/**
 * Refusals of the panel's functions that are about the object's state rather
 * than the request: the same request may succeed once the state changes.
 */
const CONFLICT_REASONS: ReadonlySet<string> = new Set([
  "serverErrors.taskClosed",
  "serverErrors.taskMovedMeanwhile",
  "serverErrors.problemNotOpen",
  "serverErrors.problemArchived",
]);

const KNOWN_API_CODES: ReadonlySet<string> = new Set(Object.keys(PROBLEMS));

/** SQLSTATEs of a value Postgres could not read: the caller sent it, so it is a 400. */
const BAD_INPUT_STATES: ReadonlySet<string> = new Set([
  "22P02", // invalid_text_representation
  "22007", // invalid_datetime_format
  "22008", // datetime_field_overflow
  "22003", // numeric_value_out_of_range
  "22023", // invalid_parameter_value
  "22001", // string_data_right_truncation
]);

function jsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (text === null || text === undefined || text.trim() === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * The problem a database refusal means, or null when it is not ours to explain
 * (the caller then answers 500 and logs the SQLSTATE).
 */
export function problemFromDatabase(error: RpcError): ApiProblem | null {
  const hint = error.hint ?? "";
  const details = jsonObject(error.details);

  if (hint.startsWith(API_HINT)) {
    const code = hint.slice(API_HINT.length);
    if (!KNOWN_API_CODES.has(code)) {
      return null;
    }
    const problemCode = code as ProblemCode;
    if (problemCode === "insufficient-scope" && typeof details?.required_scope === "string") {
      return new ApiProblem(problemCode, {
        detail: `This operation needs ${details.required_scope}`,
        required_scope: details.required_scope,
      });
    }
    if (problemCode === "invalid-request" && typeof details?.name === "string") {
      return new ApiProblem(problemCode, {
        errors: [{ name: details.name, message: error.message ?? "invalid" }],
      });
    }
    return new ApiProblem(problemCode, details === null ? {} : { params: details });
  }

  if (hint.startsWith(SERVER_ERROR_KEY)) {
    const extras: ProblemExtras = details === null ? { reason: hint } : { reason: hint, params: details };
    if (error.code === "42501") {
      return new ApiProblem("forbidden", extras);
    }
    if (error.code === "P0002") {
      return new ApiProblem("not-found", extras);
    }
    return new ApiProblem(CONFLICT_REASONS.has(hint) ? "conflict" : "rejected", extras);
  }

  // Class 22 is a value Postgres could not take (bad text, out of range, NUL):
  // the caller sent it, so it is a 400 whichever exact state it is.
  if (typeof error.code === "string" && (BAD_INPUT_STATES.has(error.code) || error.code.startsWith("22"))) {
    return new ApiProblem("invalid-request", { detail: "A value could not be read" });
  }
  return null;
}
