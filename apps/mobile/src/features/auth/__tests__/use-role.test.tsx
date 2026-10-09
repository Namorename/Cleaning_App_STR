import { renderHook } from '@testing-library/react-native';

import { useRole } from '../use-role';

/**
 * The role a screen decides by: the one the session's token carries in
 * `app_metadata`, which only the server writes. A value this build does not
 * know is no role at all, and no role is the cleaner's view — the one every
 * test of the maid's screens already covers.
 */

/** The session as the provider hands it; null while nobody is signed in. */
let mockSession: { user: { app_metadata: Record<string, unknown> } } | null = null;

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ session: mockSession, userId: null, isLoading: false }),
}));

function signedInAs(role: unknown): void {
  mockSession = { user: { app_metadata: role === undefined ? {} : { role } } };
}

beforeEach(() => {
  mockSession = null;
});

test.each(['cleaner', 'tech', 'head_tech', 'manager', 'admin'])(
  'a %s is told by the role her token carries',
  async (role) => {
    signedInAs(role);

    const { result } = await renderHook(() => useRole());

    expect(result.current).toBe(role);
  },
);

test.each([
  ['a role this build does not know', 'auditor'],
  ['a token without a role', undefined],
  ['a role that is not text', 7],
])('%s is no role', async (_case, role) => {
  signedInAs(role);

  const { result } = await renderHook(() => useRole());

  expect(result.current).toBeNull();
});

test('nobody signed in has no role', async () => {
  const { result } = await renderHook(() => useRole());

  expect(result.current).toBeNull();
});
