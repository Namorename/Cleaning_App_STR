import { afterEach, describe, expect, test } from 'vitest';

import {
  rememberSidebar,
  SIDEBAR_COOKIE,
  sidebarCookie,
  sidebarFromCookie,
} from '../sidebar-state';

/**
 * The menu's width — the full menu or the strip of icons (the owner's shell,
 * variant A) — is this browser's choice, kept in a cookie the panel's layout
 * reads on the server, so the first paint already has the width the manager
 * left it at.
 */
describe('the menu-width cookie', () => {
  afterEach(() => {
    document.cookie = `${SIDEBAR_COOKIE}=; Path=/; Max-Age=0`;
  });

  test('opens the full menu unless the strip was chosen', () => {
    expect(sidebarFromCookie(undefined)).toBe('expanded');
    expect(sidebarFromCookie('expanded')).toBe('expanded');
    expect(sidebarFromCookie('collapsed')).toBe('collapsed');
    // A cookie this build does not know is not a choice.
    expect(sidebarFromCookie('narrow')).toBe('expanded');
  });

  test('is the whole panel’s for a year, Secure on https', () => {
    expect(sidebarCookie('collapsed', false)).toBe(
      `${SIDEBAR_COOKIE}=collapsed; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    expect(sidebarCookie('expanded', true)).toBe(
      `${SIDEBAR_COOKIE}=expanded; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  });

  test('is written where the next page’s request will carry it', () => {
    rememberSidebar(document, 'collapsed');
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);

    rememberSidebar(document, 'expanded');
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=expanded`);
  });
});
