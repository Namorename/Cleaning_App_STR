import { describe, expect, test } from 'vitest';

import { fetchMyLanguage, saveMyLanguage } from '../api';

/**
 * The panel's language is the manager's own `profiles.preferred_language` —
 * the column the phone writes the same way (apps/mobile/src/features/settings/
 * api.ts, saveMyLanguage), under the policy «update own profile»
 * (supabase/tests/profile_language.sql). No migration, no RPC.
 */
const USER = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

interface Call {
  table: string;
  steps: [string, ...unknown[]][];
}

/** A client that answers every chain with `answer`, and writes down what was asked. */
function fakeClient(answer: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const chain = (call: Call): Record<string, unknown> => {
    const result = Promise.resolve(answer);
    const self: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
    };
    for (const name of ['select', 'update', 'eq', 'maybeSingle']) {
      self[name] = (...args: unknown[]) => {
        call.steps.push([name, ...args]);
        return self;
      };
    }
    return self;
  };
  const client = {
    from: (table: string) => {
      const call: Call = { table, steps: [] };
      calls.push(call);
      return chain(call);
    },
  };
  // The functions are typed against the real client; the shape above is all they touch.
  return { client: client as never, calls };
}

describe('fetchMyLanguage', () => {
  test('reads the language off the signed-in person’s own profile', async () => {
    const { client, calls } = fakeClient({ data: { preferred_language: 'cs' }, error: null });

    await expect(fetchMyLanguage(client, USER)).resolves.toBe('cs');
    expect(calls).toEqual([
      {
        table: 'profiles',
        steps: [['select', 'preferred_language'], ['eq', 'id', USER], ['maybeSingle']],
      },
    ]);
  });

  test('a profile that never chose, or no row at all, is no language', async () => {
    await expect(
      fetchMyLanguage(fakeClient({ data: { preferred_language: null }, error: null }).client, USER),
    ).resolves.toBeNull();
    await expect(
      fetchMyLanguage(fakeClient({ data: null, error: null }).client, USER),
    ).resolves.toBeNull();
  });

  test('a code the panel has no dictionary for is no language either', async () => {
    const { client } = fakeClient({ data: { preferred_language: 'de' }, error: null });

    await expect(fetchMyLanguage(client, USER)).resolves.toBeNull();
  });

  test('a failed read is thrown, not taken for «no choice»', async () => {
    const failure = { message: 'boom' };
    const { client } = fakeClient({ data: null, error: failure });

    await expect(fetchMyLanguage(client, USER)).rejects.toBe(failure);
  });
});

describe('saveMyLanguage', () => {
  test('writes the column on the person’s own row and asks the row back', async () => {
    const { client, calls } = fakeClient({ data: { id: USER }, error: null });

    await saveMyLanguage(client, USER, 'en');

    expect(calls).toEqual([
      {
        table: 'profiles',
        steps: [
          ['update', { preferred_language: 'en' }],
          ['eq', 'id', USER],
          ['select', 'id'],
          ['maybeSingle'],
        ],
      },
    ]);
  });

  test('a refusal is thrown as it came', async () => {
    const refusal = { message: 'permission denied', code: '42501' };
    const { client } = fakeClient({ data: null, error: refusal });

    await expect(saveMyLanguage(client, USER, 'en')).rejects.toBe(refusal);
  });

  // PostgREST answers an update that matched no row without an error: the
  // language would silently not stick and come back on the next sign-in.
  test('an update that changed no row is a failure', async () => {
    const { client } = fakeClient({ data: null, error: null });

    await expect(saveMyLanguage(client, USER, 'en')).rejects.toThrow(
      'Own profile row was not updated',
    );
  });
});
