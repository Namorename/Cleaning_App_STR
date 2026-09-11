import { describe, expect, test } from 'vitest';

import { functionError, ServerRefusal } from '@/lib/function-error';
import { serverErrorText } from '@/lib/server-error';

const GENERIC = 'Edge Function returned a non-2xx status code';

/**
 * What supabase-js hands over on a non-2xx: a generic error, the body in `context`.
 *
 * A real Error, as `FunctionsHttpError` is — the fallback message is read off
 * `error.message`, and a plain object would stringify to "[object Object]".
 */
const httpError = (body: unknown, json = () => Promise.resolve(body)) => {
  const error = new Error(GENERIC);
  error.name = 'FunctionsHttpError';
  return Object.assign(error, { context: { json } });
};

describe('functionError', () => {
  test('reads our refusal out of the body the generic error carries', async () => {
    const refusal = await functionError(
      httpError({
        error: {
          message: 'listing already has an automatic cleaner',
          hint: 'serverErrors.propertyCleanerTaken',
          details: '{"name":"Maria Test"}',
        },
      }),
    );

    expect(refusal).toBeInstanceOf(ServerRefusal);
    expect(refusal.message).toBe('listing already has an automatic cleaner');
    expect(refusal.hint).toBe('serverErrors.propertyCleanerTaken');
    expect(refusal.details).toBe('{"name":"Maria Test"}');
  });

  test('is a real Error, so everything that catches one still works', async () => {
    const refusal = await functionError(httpError({ error: { message: 'no' } }));

    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.name).toBe('ServerRefusal');
  });

  test('keeps the generic message when the error carries no body at all', async () => {
    const refusal = await functionError(new Error('Failed to fetch'));

    expect(refusal.message).toBe('Failed to fetch');
    expect(refusal.hint).toBeUndefined();
  });

  test('survives something thrown that is not an Error', async () => {
    const refusal = await functionError('boom');

    expect(refusal.message).toBe('boom');
  });

  test('a gateway page instead of our refusal does not become a crash', async () => {
    const refusal = await functionError(
      httpError(null, () => Promise.reject(new SyntaxError('Unexpected token < in JSON'))),
    );

    expect(refusal.message).toBe(GENERIC);
    expect(refusal.hint).toBeUndefined();
  });

  test('a body without our envelope falls back rather than inventing fields', async () => {
    const refusal = await functionError(httpError({ notOurShape: true }));

    expect(refusal.message).toBe(GENERIC);
    expect(refusal.hint).toBeUndefined();
  });

  test('an empty message in the body does not blank the reason', async () => {
    const refusal = await functionError(httpError({ error: { message: '   ' } }));

    expect(refusal.message).toBe(GENERIC);
  });

  test('hands serverErrorText something it can translate', async () => {
    const refusal = await functionError(
      httpError({
        error: {
          message: 'role not allowed',
          hint: 'serverErrors.unknown',
          details: '{}',
        },
      }),
    );

    // The key wins over the English words: the manager reads her own language.
    expect(serverErrorText(refusal).detail).toBeNull();
  });
});
