import { describe, expect, test } from 'vitest';

import PropertyPage from '../(panel)/apartments/[id]/page';

/** What the page threw: Next's redirect and 404 are thrown, with a digest saying which. */
async function thrownBy(id: string, search: Record<string, string> = {}): Promise<string> {
  try {
    await PropertyPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) });
  } catch (error) {
    return (error as { digest?: string }).digest ?? '';
  }
  return '';
}

/**
 * 5.4, «Объекты» variant B: a listing's card opens beside the registry, at
 * `/apartments?listing=<id>`. The old address of a card — a bookmark, a link
 * forwarded before the change — still leads there.
 */
describe('/apartments/<id>', () => {
  test('opens the registry with that listing’s card', async () => {
    expect(await thrownBy('201')).toMatch(/^NEXT_REDIRECT;[a-z]+;\/apartments\?listing=201;/);
  });

  test('keeps the card’s tab when the old address named one', async () => {
    expect(await thrownBy('201', { card: 'bookings' })).toContain(
      '/apartments?listing=201&card=bookings;',
    );
    expect(await thrownBy('201', { card: 'photos' })).toContain('/apartments?listing=201;');
  });

  test('a malformed id is still a 404, not a query', async () => {
    expect(await thrownBy('abc')).toMatch(/404/);
    expect(await thrownBy('-3')).toMatch(/404/);
  });
});
