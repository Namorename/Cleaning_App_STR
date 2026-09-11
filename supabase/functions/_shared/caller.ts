/**
 * Who is on the other end of a function call.
 *
 * Two callers reach the sync functions and they arrive differently. The
 * scheduler calls from inside the database over pg_net and carries the service
 * key; the panel calls from a browser and carries the manager's own token.
 * `verify_jwt` at the gateway tells them both apart from a stranger, but not
 * from each other — and "any signed-in person may start a full Hostaway sync"
 * includes every cleaner with the app on her phone.
 */

/**
 * What a browser needs before it will make the call at all.
 *
 * A preflight OPTIONS carries no Authorization header, so a function the panel
 * calls has to answer it before any token is looked at.
 */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The token out of `Authorization: Bearer …`, or null when there is none. */
export function readBearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match === null ? null : match[1].trim();
}

/** What the panel's roles are called in `app_metadata`. */
const ALLOWED_ROLES: readonly string[] = ["manager", "admin"];

export interface SyncCallerInput {
  readonly token: string | null;
  /** The service key the scheduler signs with; compared, never logged. */
  readonly serviceKey: string;
  /** Reads the caller's role out of their token, or null when it is not a user token. */
  readonly roleOf: (token: string) => Promise<string | null>;
}

/**
 * May this caller start a sync?
 *
 * The scheduler first, and by an exact match rather than a role lookup: the
 * service key belongs to no user, so asking auth about it would only produce a
 * failed lookup on every nightly run.
 */
export async function allowsSync({ token, serviceKey, roleOf }: SyncCallerInput): Promise<boolean> {
  if (token === null || token === "") {
    return false;
  }
  if (serviceKey !== "" && token === serviceKey) {
    return true;
  }

  const role = await roleOf(token);
  return role !== null && ALLOWED_ROLES.includes(role);
}
