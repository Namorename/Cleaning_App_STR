import { afterEach, describe, expect, test } from 'vitest';

import {
  applyThemeChoice,
  themeClass,
  themeCookie,
  themeFromCookie,
  THEME_COOKIE,
} from '../theme';

/**
 * The panel's theme (decision 6): as the system, light or dark, chosen in
 * «Настройки» and kept in a cookie the server reads, so <html> leaves the
 * server with the right class and the first paint is in the right colours.
 */
describe('the theme cookie', () => {
  test('takes a known choice and the system’s otherwise', () => {
    expect(themeFromCookie('light')).toBe('light');
    expect(themeFromCookie('dark')).toBe('dark');
    expect(themeFromCookie('system')).toBe('system');
    expect(themeFromCookie('sepia')).toBe('system');
    expect(themeFromCookie(undefined)).toBe('system');
  });

  test('puts a class on <html> only for a choice of the manager’s', () => {
    expect(themeClass('light')).toBe('light');
    expect(themeClass('dark')).toBe('dark');
    expect(themeClass('system')).toBeUndefined();
  });

  test('lives a year for the whole panel, and is Secure over https only', () => {
    const plain = themeCookie('dark', false);
    expect(plain).toBe(`${THEME_COOKIE}=dark; Path=/; Max-Age=31536000; SameSite=Lax`);
    expect(themeCookie('light', true)).toBe(
      `${THEME_COOKIE}=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  });
});

describe('a choice in the browser', () => {
  afterEach(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0`;
  });

  test('repaints at once and is remembered for the next page', () => {
    applyThemeChoice(document, 'dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement).not.toHaveClass('light');
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);

    applyThemeChoice(document, 'light');
    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
  });

  test('«as the system» takes both classes off', () => {
    applyThemeChoice(document, 'dark');
    applyThemeChoice(document, 'system');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement).not.toHaveClass('light');
    expect(document.cookie).toContain(`${THEME_COOKIE}=system`);
  });
});
