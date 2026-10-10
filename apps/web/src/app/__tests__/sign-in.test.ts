import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The sign-in applies the language the person keeps in her profile: chosen in
 * one browser («Настройки → Аккаунт»), the panel opens in it in the next one.
 * A profile with no choice, or a read that failed, leaves the cookie as it
 * was — the language never stands between a manager and the panel.
 */
const USER = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

const state = vi.hoisted(() => ({
  role: 'manager' as string,
  profile: { data: { preferred_language: 'cs' } as unknown, error: null as unknown },
  proto: 'https' as string | null,
}));

const setCookie = vi.fn();
const signOut = vi.fn();
const profileReads: unknown[][] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({
        data: { user: { id: USER, app_metadata: { role: state.role } } },
        error: null,
      }),
      signOut: async () => signOut(),
    },
    from: (table: string) => {
      const answer = Promise.resolve(state.profile);
      const chain: Record<string, unknown> = {
        then: answer.then.bind(answer),
        catch: answer.catch.bind(answer),
      };
      for (const name of ['select', 'eq', 'maybeSingle']) {
        chain[name] = (...args: unknown[]) => {
          profileReads.push([table, name, ...args]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: setCookie, get: () => undefined, getAll: () => [] }),
  headers: async () => ({
    get: (name: string) => (name === 'x-forwarded-proto' ? state.proto : null),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import { signIn } from '../(auth)/login/actions';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

function form(): FormData {
  const data = new FormData();
  data.set('email', 'manager@test.local');
  data.set('password', 'secret');
  data.set('next', '/problems');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  profileReads.length = 0;
  state.role = 'manager';
  state.profile = { data: { preferred_language: 'cs' }, error: null };
  state.proto = 'https';
});

describe('signing in', () => {
  test('sets the language the profile keeps, then opens the panel', async () => {
    await expect(signIn({ issue: null, email: '' }, form())).rejects.toThrow('redirect:/problems');

    expect(profileReads).toContainEqual(['profiles', 'eq', 'id', USER]);
    expect(setCookie).toHaveBeenCalledWith('lang', 'cs', {
      path: '/',
      maxAge: YEAR_SECONDS,
      sameSite: 'lax',
      secure: true,
    });
  });

  test('a page served over plain http gets a cookie it can send back', async () => {
    state.proto = null;

    await expect(signIn({ issue: null, email: '' }, form())).rejects.toThrow('redirect:/problems');

    expect(setCookie).toHaveBeenCalledWith(
      'lang',
      'cs',
      expect.objectContaining({ secure: false }),
    );
  });

  test('a profile with no choice leaves the cookie as it was', async () => {
    state.profile = { data: { preferred_language: null }, error: null };

    await expect(signIn({ issue: null, email: '' }, form())).rejects.toThrow('redirect:/problems');

    expect(setCookie).not.toHaveBeenCalledWith('lang', expect.anything(), expect.anything());
  });

  test('a failed read of the language does not stand in the way', async () => {
    state.profile = { data: null, error: { message: 'boom' } };

    await expect(signIn({ issue: null, email: '' }, form())).rejects.toThrow('redirect:/problems');

    expect(setCookie).not.toHaveBeenCalledWith('lang', expect.anything(), expect.anything());
  });

  test('somebody the panel is not for is signed out before any language is read', async () => {
    state.role = 'cleaner';

    await expect(signIn({ issue: null, email: '' }, form())).resolves.toEqual({
      issue: 'notManager',
      email: 'manager@test.local',
    });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(profileReads).toEqual([]);
    expect(setCookie).not.toHaveBeenCalledWith('lang', expect.anything(), expect.anything());
  });
});
