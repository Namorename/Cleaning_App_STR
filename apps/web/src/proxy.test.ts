// @vitest-environment node
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Who the request belongs to, as Auth would answer: nobody, or a manager.
const auth = { user: null as null | { app_metadata: Record<string, unknown> } };
const getUser = vi.fn(async () => ({ data: { user: auth.user } }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { PAGE_LANGUAGE_HEADER } from '@/lib/page-language';

import { config, proxy } from './proxy';

const ORIGIN = 'https://panel.example';

beforeEach(() => {
  auth.user = null;
  getUser.mockClear();
});

/** Where the proxy sends the request, or null when it lets it through. */
async function redirectOf(pathAndQuery: string): Promise<URL | null> {
  const response = await proxy(new NextRequest(`${ORIGIN}${pathAndQuery}`));
  const location = response.headers.get('location');
  return location === null ? null : new URL(location);
}

/**
 * ROADMAP «Вход теряет параметры адреса»: a bookmarked or forwarded link with
 * filters in it must open with those filters after the sign-in, now that the
 * cleanings keep their tab and filters in the address.
 */
describe('the way to the sign-in page', () => {
  test('carries the whole address back, the query included', async () => {
    const target = await redirectOf('/calendar?assignee=nobody');

    expect(target?.pathname).toBe('/login');
    expect(target?.searchParams.get('next')).toBe('/calendar?assignee=nobody');
  });

  test('leaves the sign-in page nothing but the way back', async () => {
    const target = await redirectOf('/tasks?tab=closed&q=vinohrady&type=cleaning');

    expect([...(target?.searchParams.keys() ?? [])]).toEqual(['next']);
    expect(target?.searchParams.get('next')).toBe('/tasks?tab=closed&q=vinohrady&type=cleaning');
  });

  test('a plain path stays a plain path', async () => {
    const target = await redirectOf('/problems');

    expect(target?.search).toBe(`?next=${encodeURIComponent('/problems')}`);
  });

  test('a manager on the sign-in page goes to the dashboard, with nothing carried over', async () => {
    auth.user = { app_metadata: { role: 'manager' } };

    const target = await redirectOf('/login?next=%2Ftasks%3Ftab%3Dclosed');

    expect(target?.pathname).toBe('/dashboard');
    expect(target?.search).toBe('');
  });

  test('a manager elsewhere passes through', async () => {
    auth.user = { app_metadata: { role: 'manager' } };

    expect(await redirectOf('/tasks?tab=closed')).toBeNull();
  });
});

/**
 * Decision 17 (docs/f11-plan.md): the privacy policy is a public page on the
 * panel's domain. App Store Connect links to it, so a visitor who never signed
 * in must read it, and so must a manager — without being sent to the
 * dashboard as the sign-in page sends them.
 */
describe('the privacy policy', () => {
  test.each(['/privacy', '/privacy?lang=en'])(
    'opens %s to a visitor who is not signed in, without asking Auth',
    async (path) => {
      expect(await redirectOf(path)).toBeNull();
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  test.each(['/privacy', '/privacy?lang=ru'])(
    'opens %s to a signed-in manager, without asking Auth',
    async (path) => {
      auth.user = { app_metadata: { role: 'manager' } };

      expect(await redirectOf(path)).toBeNull();
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  test('opens to a signed-in cleaner as well, without asking Auth', async () => {
    auth.user = { app_metadata: { role: 'cleaner' } };

    expect(await redirectOf('/privacy?lang=cs')).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  test.each(['/privacyx', '/privacy/x', '/privacy-policy'])(
    'opens the exact path only: %s still asks for the sign-in',
    async (path) => {
      const target = await redirectOf(path);

      expect(target?.pathname).toBe('/login');
      expect(target?.searchParams.get('next')).toBe(path);
    },
  );

  // Fails closed: a spelling Next might still route to the page is not the
  // open path, so the guard runs and a visitor is sent to the sign-in.
  test.each(['/Privacy', '//privacy', '/%70rivacy', '/privacy/'])(
    'treats %s as a guarded path',
    async (path) => {
      const target = await redirectOf(path);

      expect(getUser).toHaveBeenCalledTimes(1);
      // NextURL keeps a trailing slash it was given: `/login/` for `/privacy/`.
      expect(target?.pathname).toMatch(/^\/login\/?$/);
    },
  );

  test('leaves the dashboard behind the sign-in', async () => {
    const target = await redirectOf('/dashboard');

    expect(target?.pathname).toBe('/login');
    expect(target?.searchParams.get('next')).toBe('/dashboard');
  });

  test('still sends a manager from the sign-in page to the dashboard', async () => {
    auth.user = { app_metadata: { role: 'manager' } };

    expect((await redirectOf('/login'))?.pathname).toBe('/dashboard');
  });
});

/**
 * The language the page itself speaks, handed to the root layout for
 * `<html lang>`: the policy's is its address's (`?lang=`, Czech by default),
 * not the panel's cookie. Next forwards a request header the proxy sets as
 * `x-middleware-request-<name>` on the response.
 */
describe('the privacy policy’s language for <html lang>', () => {
  async function forwardedLanguage(pathAndQuery: string): Promise<string | null> {
    const response = await proxy(new NextRequest(`${ORIGIN}${pathAndQuery}`));
    return response.headers.get(`x-middleware-request-${PAGE_LANGUAGE_HEADER}`);
  }

  test.each([
    ['/privacy', 'cs'],
    ['/privacy?lang=en', 'en'],
    ['/privacy?lang=ru', 'ru'],
    ['/privacy?lang=xx', 'cs'],
    ['/privacy?lang=EN', 'cs'],
    ['/privacy?lang=en&lang=ru', 'cs'],
  ])('%s is read as %s, as the page reads it', async (path, language) => {
    expect(await forwardedLanguage(path)).toBe(language);
  });

  test('keeps the visitor’s own headers on the way', async () => {
    const response = await proxy(
      new NextRequest(`${ORIGIN}/privacy`, { headers: { 'accept-language': 'cs-CZ' } }),
    );

    expect(response.headers.get('x-middleware-request-accept-language')).toBe('cs-CZ');
  });

  test.each(['/tasks', '/login', '/privacyx'])('names no language for %s', async (path) => {
    auth.user = { app_metadata: { role: 'manager' } };

    expect(await forwardedLanguage(path)).toBeNull();
  });
});

/**
 * Which requests the sign-in guard sees at all, by Next's own reading of the
 * matcher. The logo sits on the sign-in card, so its files must reach a
 * visitor who has not signed in (docs/redesign-plan.md, 6.1) — the raster
 * ones too, should the owner send PNGs.
 */
describe('the proxy matcher', () => {
  test.each([
    '/brand/logo-light.svg',
    '/brand/logo-dark.svg',
    '/brand/logo-light@2x.png',
    '/brand/logo-dark@2x.png',
  ])('lets %s through without the sign-in check', (pathname) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${pathname}` })).toBe(false);
  });

  test.each(['/login', '/dashboard', '/settings', '/brand'])('still guards %s', (pathname) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${pathname}` })).toBe(true);
  });
});
