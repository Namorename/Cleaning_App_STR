import { claimTask, finishTask, startTask } from '../api';

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
  property: { name: 'CZ - Nadrazni Apt 6', cleaner_notes: null },
  time_from: '10:00:00',
  time_to: '15:00:00',
  guests_count: null,
  started_at: null,
  completed_at: null,
  is_parallel: false,
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

describe('startTask', () => {
  test('returns the task once it is in progress', async () => {
    mockResponse.data = [{ ...row, status: 'in_progress', started_at: '2026-11-10T08:00:00+00:00' }];

    const started = await startTask(row.id);

    expect(started.status).toBe('in_progress');
    expect(started.started_at).not.toBeNull();
  });

  test('explains when the task could not be started', async () => {
    // Zero rows: the task is no longer assigned to her, or the server refused
    // the move — a second start with parallel work switched off, for instance.
    mockResponse.data = [];

    await expect(startTask(row.id)).rejects.toThrow('Не удалось начать уборку — обновите список.');
  });
});

describe('finishTask', () => {
  test('returns the task once it is done', async () => {
    mockResponse.data = [{ ...row, status: 'done', completed_at: '2026-11-10T10:00:00+00:00' }];

    const finished = await finishTask(row.id);

    expect(finished.status).toBe('done');
  });

  test('explains when the task could not be finished', async () => {
    mockResponse.data = [];

    await expect(finishTask(row.id)).rejects.toThrow(
      'Не удалось завершить уборку — обновите список.',
    );
  });
});
