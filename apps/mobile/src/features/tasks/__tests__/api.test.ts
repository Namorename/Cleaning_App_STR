import { claimTask } from '../api';

const mockResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => Promise.resolve(mockResponse),
          }),
        }),
      }),
    }),
  },
}));

const row = {
  id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
  status: 'assigned',
  priority: 1,
  scheduled_date: '2026-11-10',
  due_at: '2026-11-10T13:00:00+00:00',
  assignee_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  property_id: 412432,
  property: { name: 'CZ - Nadrazni Apt 6' },
};

beforeEach(() => {
  mockResponse.data = null;
  mockResponse.error = null;
});

test('returns the claimed task when the update took the row', async () => {
  mockResponse.data = [row];

  const claimed = await claimTask(row.id, '7c9e6679-7425-40de-944b-e07fc1f90ae7');

  expect(claimed.assignee_id).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
  expect(claimed.status).toBe('assigned');
});

test('reports that the task is gone when the update took no row', async () => {
  // Zero rows, not an error: the filters simply matched nothing — a colleague
  // was faster, or the server refused work past its day. Silently resolving
  // here would show the cleaner a task that is not hers.
  mockResponse.data = [];

  await expect(claimTask(row.id, '7c9e6679-7425-40de-944b-e07fc1f90ae7')).rejects.toThrow(
    'Задачу уже взяли, либо её срок истёк.',
  );
});

test('surfaces a transport failure instead of treating it as a lost race', async () => {
  mockResponse.error = new Error('network unreachable');

  await expect(claimTask(row.id, '7c9e6679-7425-40de-944b-e07fc1f90ae7')).rejects.toThrow(
    'network unreachable',
  );
});

test('rejects a row that does not match the expected shape', async () => {
  mockResponse.data = [{ ...row, priority: 'urgent' }];

  await expect(claimTask(row.id, '7c9e6679-7425-40de-944b-e07fc1f90ae7')).rejects.toThrow();
});
