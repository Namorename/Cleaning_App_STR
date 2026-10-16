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
import { Providers } from '../providers';

afterEach(() => {
  cookieJar.clear();
  headerJar.clear();
});

/** The `lang` the layout puts on <html>, read off the element it returns. */
async function htmlLang(): Promise<unknown> {
  const html = await RootLayout({ children: null });
  return html.props.lang;
}

/** Every element of a tree the layout returned, without rendering it. */
function elementsOf(node: unknown): { type: unknown; props: Record<string, unknown> }[] {
  if (Array.isArray(node)) {
    return node.flatMap(elementsOf);
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    return [];
  }
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [element, ...elementsOf(element.props.children)];
}

/** The language the layout hands the dictionary — what every page, /login too, is drawn in. */
async function dictionaryLanguage(): Promise<unknown> {
  const html = await RootLayout({ children: null });
  return elementsOf(html).find((element) => element.type === Providers)?.props.language;
}

/**
 * <html lang> names the language the page is written in (WCAG 3.1.1): the
 * panel's pages speak the manager's cookie language, the public privacy page
 * the language of its address, which the proxy forwards in a header.
 */
describe('the document’s language', () => {
  test('is the panel’s default, English, when nothing names one', async () => {
    expect(await htmlLang()).toBe('en');
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

/**
 * The owner's decision of 14.10: a guest who chose nothing reads English on
 * every page — the sign-in, the 404, the error page — and the browser's own
 * language is not a choice. A choice is the `lang` cookie: set by the switcher
 * on the sign-in page, or by the sign-in from the profile.
 */
describe('the language every page is drawn in', () => {
  test('a guest with no cookie gets English, whatever the browser asks for', async () => {
    headerJar.set('accept-language', 'ru-RU,ru;q=0.9,cs;q=0.8');

    expect(await dictionaryLanguage()).toBe('en');
    expect(await htmlLang()).toBe('en');
  });

  test('a cookie `ru` gives Russian', async () => {
    cookieJar.set(LANGUAGE_COOKIE, 'ru');

    expect(await dictionaryLanguage()).toBe('ru');
    expect(await htmlLang()).toBe('ru');
  });

  test('a cookie `cs` gives Czech, over a browser that asks for English', async () => {
    cookieJar.set(LANGUAGE_COOKIE, 'cs');
    headerJar.set('accept-language', 'en-US,en;q=0.9');

    expect(await dictionaryLanguage()).toBe('cs');
    expect(await htmlLang()).toBe('cs');
  });
});
