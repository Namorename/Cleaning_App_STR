import { describe, expect, test } from 'vitest';

import ProblemPage from '../(panel)/problems/[id]/page';

const ID = '11111111-1111-4111-8111-111111111111';

/** The props the page hands its view, or the digest of what it threw. */
async function pageFor(id: string, search: Record<string, string | string[]> = {}) {
  try {
    const element = await ProblemPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(search),
    });
    return element.props as { problemId: string; listView: string };
  } catch (error) {
    return (error as { digest?: string }).digest ?? '';
  }
}

/** Owner, 05.10: «К списку заданий» returns to the view the task was opened from. */
describe('/problems/<id>', () => {
  test('hands the page the view it was opened from', async () => {
    expect(await pageFor(ID, { view: 'archive' })).toEqual({ problemId: ID, listView: 'archive' });
  });

  test('a page opened from elsewhere returns to the board', async () => {
    expect(await pageFor(ID)).toEqual({ problemId: ID, listView: 'board' });
    expect(await pageFor(ID, { view: 'kanban' })).toEqual({ problemId: ID, listView: 'board' });
  });

  test('a malformed id is a 404, not a query', async () => {
    expect(await pageFor('abc')).toMatch(/404/);
  });
});
