import { describe, expect, test, vi } from 'vitest';

vi.mock('@/features/quality/quality-place-view', () => ({ QualityPlaceView: () => null }));
vi.mock('@/features/quality/areas-view', () => ({ AreasView: () => 'the areas' }));

import QualityPlacePage from '../(panel)/quality/[id]/page';
import QualityAreasPage from '../(panel)/quality/areas/page';

/** What the page threw: Next's 404 is thrown, with a digest saying so. */
async function thrownBy(id: string): Promise<string> {
  try {
    await QualityPlacePage({ params: Promise.resolve({ id }) });
  } catch (error) {
    return (error as { digest?: string }).digest ?? '';
  }
  return '';
}

describe('/quality/areas', () => {
  test('is a page of its own, not a place called «areas»', async () => {
    expect(await thrownBy('areas')).toMatch(/404/);
    expect(QualityAreasPage().type).toBeTypeOf('function');
  });
});

/**
 * The proxy lets a path ending in .png past its check, so this page must not
 * take such a path for a place: the head technician would reach it that way.
 */
describe('/quality/<id>', () => {
  test('hands digits to the card', async () => {
    const page = await QualityPlacePage({ params: Promise.resolve({ id: '201' }) });

    expect(page.props.placeId).toBe(201);
  });

  test.each(['x.png', '201.png', 'abc', '-3', '1e3', '0x10', ' 5', '0'])(
    '%j is a 404',
    async (id) => {
      expect(await thrownBy(id)).toMatch(/404/);
    },
  );
});
