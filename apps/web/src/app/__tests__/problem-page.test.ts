import { describe, expect, test, vi } from 'vitest';

// Who reads the page: an admin may delete an archived task for good (20261126150000).
let signedIn: { app_metadata: Record<string, unknown> } | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn } }) },
  }),
}));

import ProblemPage from '../(panel)/problems/[id]/page';

const ID = '11111111-1111-4111-8111-111111111111';

/** The props the page hands its view, or the digest of what it threw. */
async function pageFor(id: string) {
  try {
    const element = await ProblemPage({ params: Promise.resolve({ id }) });
    return element.props as { problemId: string; isAdmin: boolean };
  } catch (error) {
    return (error as { digest?: string }).digest ?? '';
  }
}

/**
 * The view the task was opened from (owner, 05.10) and its open conversation
 * (5.4, «Чат») are the page's to read from its own address, beside the
 * conversation they share it with: problem-detail.test.tsx.
 */
describe('/problems/<id>', () => {
  test('hands the page the task’s id and whether its reader is an admin', async () => {
    signedIn = { app_metadata: { role: 'manager' } };
    expect(await pageFor(ID)).toEqual({ problemId: ID, isAdmin: false });
    signedIn = { app_metadata: { role: 'admin' } };
    expect(await pageFor(ID)).toEqual({ problemId: ID, isAdmin: true });
  });

  test('a malformed id is a 404, not a query', async () => {
    expect(await pageFor('abc')).toMatch(/404/);
  });
});
