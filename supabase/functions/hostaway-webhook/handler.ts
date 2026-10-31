/**
 * Hostaway webhook intake.
 *
 * RESPONSE CODES matter most here. Per Hostaway's documentation:
 *   - any 2xx means "accepted";
 *   - a network error, 5xx and 429 are a transient failure: the delivery is
 *     retried up to three times within about an hour;
 *   - any other 4xx (400, 401, 403, 404) is a PERMANENT refusal: there is no
 *     retry, and the event is lost for good;
 *   - five days of failures in a row, and Hostaway disables the webhook.
 *
 * Hence the rule: whatever is our fault answers 5xx, so that Hostaway asks
 * again; 4xx is left for requests that really must not be accepted.
 *
 *   secrets not readable       -> 500  our deployment error, retryable
 *   journal write failed       -> 500  a transient database failure, retryable
 *   no/broken/wrong password   -> 401  a forgery must not be accepted
 *   body did not parse         -> 200  a retry will not help; stored as it is
 *   unknown event              -> 200  the documentation's own advice
 *
 * The configuration is checked BEFORE the header: otherwise a deployment with
 * a forgotten secret would pass for an unauthorised request and quietly drop
 * reservations.
 *
 * A guest message is stored without its text and contact details
 * (guest-message.ts); every other notification is stored as it came.
 */

import { type BasicCredentials, verifyBasicAuth } from "../_shared/basic-auth.ts";
import { ConfigError } from "../_shared/env.ts";
import { journalPayload, journalUnparsed } from "./guest-message.ts";

export interface WebhookDeps {
  /** May throw ConfigError when the secrets are not set. */
  readonly loadCredentials: () => BasicCredentials;
  /** Writes the notification to the journal and returns its number. */
  readonly recordEvent: (payload: unknown) => Promise<number>;
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The body as the journal keeps it.
 *
 * An unreadable body is not thrown away: it is wrapped in an object and still
 * reaches the journal. Losing a notification is worse than keeping it raw. A
 * guest message, parsed or not, keeps no text (guest-message.ts).
 */
async function readPayload(request: Request): Promise<unknown> {
  const text = await request.text();

  try {
    return journalPayload(JSON.parse(text) as unknown);
  } catch {
    return journalUnparsed(text, request.headers.get("Content-Type"));
  }
}

export function createWebhookHandler(deps: WebhookDeps): (request: Request) => Promise<Response> {
  return async function handleWebhook(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "POST expected" }, 405);
    }

    // 1. Configuration. Checked first: its absence is our fault, and the
    //    answer has to be retryable.
    let credentials: BasicCredentials;
    try {
      credentials = deps.loadCredentials();
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      console.error(`Webhook is not configured; replying 500 so Hostaway retries: ${message}`);
      return json(
        { error: error instanceof ConfigError ? "Function is not configured" : "Internal error" },
        500,
      );
    }

    // 2. Authorisation. The only protection: Hostaway sends no signatures.
    const auth = await verifyBasicAuth(request.headers.get("Authorization"), credentials);
    if (!auth.ok) {
      // The reason goes to the log because a 401 is never retried: if this
      // was a real delivery, the reservation is lost, and this line and the
      // daily reconciliation are all there is to go on.
      console.error(
        `Webhook rejected (${auth.reason}). Hostaway will NOT retry. ` +
          (auth.reason === "missing"
            ? "The webhook was probably registered without a login and password."
            : "Check that the credentials match the ones used at registration."),
      );

      return json({ error: "Invalid credentials" }, 401, {
        "WWW-Authenticate": 'Basic realm="hostaway-webhook"',
      });
    }

    // 3. The body. Read only after authorisation: an unauthorised request
    //    must not reach the journal.
    const payload = await readPayload(request);

    // 4. The write. A failure here is transient, hence 500: Hostaway asks again.
    try {
      const eventId = await deps.recordEvent(payload);
      return json({ accepted: true, eventId }, 200);
    } catch (error: unknown) {
      console.error(
        `Failed to record the notification; replying 500 so Hostaway retries: ${getErrorMessage(error)}`,
      );
      return json({ error: "Failed to accept the notification" }, 500);
    }
  };
}
