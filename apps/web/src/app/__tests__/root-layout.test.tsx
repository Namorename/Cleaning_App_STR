import { afterEach, describe, expect, test, vi } from 'vitest';

// The request as the root layout reads it: its cookies and its headers.
const cookieJar = new Map<string, string>();
const headerJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
  }),
  headers: async () => new Headers([...headerJar]),
}));

// next/font is compiled by Next alone; the font is not what is under test here.
vi.mock('next/font/google', () => ({
  Nunito: () => ({ variable: 'font-sans-variable', className: '' }),
}));

import { LANGUAGE_COOKIE } from '@/lib/language';
import { PAGE_LANGUAGE_HEADER } from '@/lib/page-language';

import RootLayout from '../layout';

afterEach(() => {
  cookieJar.clear();
  headerJar.clear();
});

/** The `lang` the layout puts on <html>, read off the element it returns. */
async function htmlLang(): Promise<unknown> {
  const html = await RootLayout({ children: null });
  return html.props.lang;
}

/**
 * <html lang> names the language the page is written in (WCAG 3.1.1): the
 * panel's pages speak the manager's cookie language, the public privacy page
 * the language of its address, which the proxy forwards in a header.
 */
describe('the document’s language', () => {
  test('is the panel’s default when nothing names one', async () => {
    expect(await htmlLang()).toBe('ru');
  });

  test('follows the manager’s cookie on the panel’s pages', async () => {
    cookieJar.set(LANGUAGE_COOKIE, 'en');

    expect(await htmlLang()).toBe('en');
  });

  test('is the page’s own when the proxy names it, over the cookie', async () => {
    cookieJar.set(LANGUAGE_COOKIE, 'ru');
    headerJar.set(PAGE_LANGUAGE_HEADER, 'cs');

    expect(await htmlLang()).toBe('cs');
  });

  test.each(['xx', '', 'CS'])('ignores a page language it does not speak: %j', async (value) => {
    cookieJar.set(LANGUAGE_COOKIE, 'en');
    headerJar.set(PAGE_LANGUAGE_HEADER, value);

    expect(await htmlLang()).toBe('en');
  });
});
