/**
 * What an Edge Function refused with, in the shape the panel already speaks.
 *
 * `functions.invoke` does not hand the body over: on a non-2xx it returns a
 * `FunctionsHttpError` whose `message` is the generic "Edge Function returned a
 * non-2xx status code" and whose `context` is the untouched Response. The
 * refusal we actually sent — English message, i18n key, parameters — is inside
 * that body, so it has to be read out before `serverErrorText()` can translate
 * it exactly as it translates a refusal raised by the database.
 *
 * The check is on the shape rather than `instanceof`: the panel and
 * supabase-js can end up holding two copies of the error class, and an
 * `instanceof` that quietly fails would turn every refusal into "unknown
 * error".
 */

/**
 * A refusal from a function, carrying the three fields `serverErrorText()` reads.
 *
 * A real Error rather than a bare object: it is thrown, and everything that
 * catches it — TanStack Query, the boundary above it, a stack trace in the
 * console — expects an Error.
 */
export class ServerRefusal extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = "ServerRefusal";
  }
}

interface WithResponse {
  context: { json: () => Promise<unknown> };
}

function carriesBody(error: unknown): error is WithResponse {
  if (typeof error !== 'object' || error === null || !('context' in error)) {
    return false;
  }
  const context = (error as { context?: { json?: unknown } }).context;
  return typeof context?.json === 'function';
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export async function functionError(error: unknown): Promise<ServerRefusal> {
  const fallback = error instanceof Error ? error.message : String(error);

  if (!carriesBody(error)) {
    return new ServerRefusal(fallback);
  }

  try {
    const body: unknown = await error.context.json();
    const refusal = (body as { error?: unknown } | null)?.error;
    if (typeof refusal !== 'object' || refusal === null) {
      return new ServerRefusal(fallback);
    }

    const { message, hint, details } = refusal as Record<string, unknown>;
    return new ServerRefusal(asText(message) ?? fallback, asText(hint), asText(details));
  } catch {
    // A gateway timeout, a proxy page, a body already read — none of them are
    // our refusal, and none of them should replace it with a crash.
    return new ServerRefusal(fallback);
  }
}
