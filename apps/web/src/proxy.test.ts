// @vitest-environment node
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, test } from 'vitest';

import { config } from './proxy';

const ORIGIN = 'https://panel.example';

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
