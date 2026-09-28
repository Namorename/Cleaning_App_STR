/**
 * The Expo Push API, as much of it as the sender needs.
 *
 * https://docs.expo.dev/push-notifications/sending-notifications/ (read
 * 2026-09-28): up to 100 messages a request, a ticket per message in the same
 * order; receipts for up to 1000 tickets a request. 429 and 5xx are waited out
 * with a growing pause; any other refusal is the request's own fault and is
 * not repeated.
 */

import { isRecord } from "../_shared/coerce.ts";

export const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const MESSAGES_PER_REQUEST = 100;
export const RECEIPTS_PER_REQUEST = 1_000;

/** One try and three more, 1 s, 2 s and 4 s apart: inside one run of the minute. */
const MAX_ATTEMPTS = 4;
const FIRST_PAUSE_MS = 1_000;

/**
 * One request's longest wait. The runtime sets no timeout of its own, and a
 * run must finish inside its lease (claim_push_batch, two minutes).
 */
const REQUEST_TIMEOUT_MS = 15_000;

export interface ExpoMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly sound: "default";
  readonly priority: "high";
  readonly channelId: "urgent" | "general";
  readonly interruptionLevel: "active" | "time-sensitive";
  /** iPhone only: on Android it becomes FCM's collapse key, of which FCM keeps four. */
  readonly collapseId?: string;
  readonly tag: string;
  readonly threadId: string;
  readonly ttl: number;
}

export interface ExpoFailureDetails {
  readonly error?: string;
}

export type ExpoTicket =
  | { readonly status: "ok"; readonly id: string }
  | { readonly status: "error"; readonly message?: string; readonly details?: ExpoFailureDetails };

export interface ExpoReceipt {
  readonly status: "ok" | "error";
  readonly message?: string;
  readonly details?: ExpoFailureDetails;
}

/** Expo did not answer, or kept answering 429/5xx: nothing was sent. */
export class ExpoUnavailableError extends Error {
  override readonly name = "ExpoUnavailableError";
}

/** Expo refused the request itself, or answered in a shape this code cannot read. */
export class ExpoRequestError extends Error {
  override readonly name = "ExpoRequestError";
}

export interface ExpoClientOptions {
  /** Replaced in tests, so no test reaches the network. */
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** "Enhanced security" (docs/f11-plan.md, 7.6): without it anyone with a token may push. */
  readonly accessToken?: string | null;
  /** The clock, in ms; replaced in tests. */
  readonly now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function readDetails(value: unknown): ExpoFailureDetails | undefined {
  return isRecord(value) && typeof value.error === "string" ? { error: value.error } : undefined;
}

function readFailure(value: Record<string, unknown>) {
  const details = readDetails(value.details);
  return {
    ...(typeof value.message === "string" ? { message: value.message } : {}),
    ...(details === undefined ? {} : { details }),
  };
}

function readTicket(value: unknown): ExpoTicket | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.status === "ok" && typeof value.id === "string") {
    return { status: "ok", id: value.id };
  }
  return value.status === "error" ? { status: "error", ...readFailure(value) } : null;
}

function readReceipt(value: unknown): ExpoReceipt | null {
  if (!isRecord(value) || (value.status !== "ok" && value.status !== "error")) {
    return null;
  }
  return { status: value.status, ...readFailure(value) };
}

/** The codes of a refused request, for the log: "PUSH_TOO_MANY_NOTIFICATIONS: …". */
function describeRefusal(status: number, body: unknown): string {
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  const described = errors
    .filter(isRecord)
    .map((error) =>
      [error.code, error.message].filter((part) => typeof part === "string").join(": ")
    )
    .filter((text) => text !== "");
  const codes = described.length > 0 ? `: ${described.join("; ")}` : "";
  return `Expo refused the request (${status})${codes}`;
}

export class ExpoPushClient {
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #accessToken: string | null;
  readonly #now: () => number;

  constructor(options: ExpoClientOptions = {}) {
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#accessToken = options.accessToken ?? null;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Send up to 100 messages; one ticket back for each, in the same order.
   * The caller keeps a group's messages in one call, so a group is either
   * sent or not. `deadline` (ms, the caller's clock) is when the run's lease
   * ends: no attempt starts that could not finish before it.
   */
  async send(messages: readonly ExpoMessage[], deadline?: number): Promise<ExpoTicket[]> {
    if (messages.length === 0) {
      return [];
    }
    if (messages.length > MESSAGES_PER_REQUEST) {
      throw new ExpoRequestError(`At most ${MESSAGES_PER_REQUEST} messages a request`);
    }
    const body = await this.#post(EXPO_SEND_URL, messages, deadline);
    const data = isRecord(body) && Array.isArray(body.data) ? body.data : null;
    const tickets = data === null ? [] : data.map(readTicket);
    if (data === null || tickets.length !== messages.length || tickets.includes(null)) {
      throw new ExpoRequestError("Expo answered with tickets that do not match the messages");
    }
    return tickets as ExpoTicket[];
  }

  /** The receipts Expo has for these tickets; a ticket it has none for yet is left out. */
  async receipts(ticketIds: readonly string[]): Promise<Map<string, ExpoReceipt>> {
    const receipts = new Map<string, ExpoReceipt>();
    for (const ids of chunks(ticketIds, RECEIPTS_PER_REQUEST)) {
      const body = await this.#post(EXPO_RECEIPTS_URL, { ids });
      const data = isRecord(body) && isRecord(body.data) ? body.data : {};
      for (const [id, value] of Object.entries(data)) {
        const receipt = readReceipt(value);
        if (receipt !== null) {
          receipts.set(id, receipt);
        }
      }
    }
    return receipts;
  }

  async #post(url: string, payload: unknown, deadline?: number): Promise<unknown> {
    const headers: Record<string, string> = {
      "accept": "application/json",
      "accept-encoding": "gzip, deflate",
      "content-type": "application/json",
    };
    if (this.#accessToken !== null) {
      headers.authorization = `Bearer ${this.#accessToken}`;
    }

    let lastFailure = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const pause = attempt > 1 ? FIRST_PAUSE_MS * 2 ** (attempt - 2) : 0;
      const left = deadline === undefined ? REQUEST_TIMEOUT_MS : deadline - this.#now() - pause;
      if (left <= 0) {
        const why = lastFailure === "" ? "" : `: ${lastFailure}`;
        throw new ExpoUnavailableError(`No time left in the run${why}`);
      }
      if (pause > 0) {
        await this.#sleep(pause);
      }
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, left)),
        });
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 429 || response.status >= 500) {
        lastFailure = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) {
        throw new ExpoRequestError(describeRefusal(response.status, body));
      }
      return body;
    }
    throw new ExpoUnavailableError(
      `Expo did not answer after ${MAX_ATTEMPTS} attempts: ${lastFailure}`,
    );
  }
}
