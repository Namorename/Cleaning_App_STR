import { serverErrorText } from '@/lib/server-error';

import { acceptTask, claimTask, finishTask, startTask } from '../api';

const mockResponse: { data: unknown; error: unknown } = { data: null, error: null };
/**
 * What the last move wrote, which statuses it was allowed to move from, and
 * what else the row had to still be.
 */
const mockSent: { patch: unknown; from: unknown; same: [string, unknown][] } = {
  patch: null,
  from: null,
  same: [],
};

/** The filters after the status one: each narrows the row the move may touch. */
function mockNarrowing(): object {
  return {
    eq: (column: string, value: unknown) => {
      mockSent.same.push([column, value]);
      return mockNarrowing();
    },
    select: () => Promise.resolve(mockResponse),
  };
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: unknown) => {
        mockSent.patch = patch;
        return {
          eq: () => ({
            in: (_column: string, from: unknown) => {
              mockSent.from = from;
              return mockNarrowing();
            },
          }),
        };
      },
    }),
  },
}));

const SEEN = {
  taskId: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
  scheduledDate: '2026-11-10',
  propertyId: 412432,
};

const row = {
  id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
  status: 'assigned',
  priority: 1,
  scheduled_date: '2026-11-10',
  due_at: '2026-11-10T13:00:00+00:00',
  assignee_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  property_id: 412432,
  property: { name: 'CZ - Nadrazni Apt 6', effective_cleaner_notes: null },
  time_from: '10:00:00',
  time_to: '15:00:00',
  guests_count: null,
  started_at: null,
  completed_at: null,
  is_parallel: false,
  type: 'cleaning',
};

beforeEach(() => {
  mockResponse.data = null;
  mockResponse.error = null;
  mockSent.patch = null;
  mockSent.from = null;
  mockSent.same = [];
});

test('returns the claimed task when the update took the row', async () => {
  mockResponse.data = [{ ...row, status: 'accepted' }];

  const claimed = await claimTask(row.id, '7c9e6679-7425-40de-944b-e07fc1f90ae7');

  expect(claimed.assignee_id).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
  expect(claimed.status).toBe('accepted');
});

test('a free cleaning she takes is accepted at once: she chose it', async () => {
  // Owner's decision 5c (F11): taking free work is accepting it, so the
  // office's "not accepted for tomorrow" does not list what she picked herself.
  mockResponse.data = [{ ...row, status: 'accepted' }];

  await claimTask(row.id, '7c9e6679-7425-40de-944b-e07fc1f90ae7');

  expect(mockSent.patch).toEqual({
    assignee_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    status: 'accepted',
  });
  expect(mockSent.from).toEqual(['unassigned']);
});

describe('acceptTask', () => {
  test('marks her cleaning accepted and returns it', async () => {
    // Arrange
    mockResponse.data = [{ ...row, status: 'accepted' }];

    // Act
    const accepted = await acceptTask(SEEN);

    // Assert
    expect(accepted.status).toBe('accepted');
    expect(mockSent.patch).toEqual({ status: 'accepted' });
  });

  test('accepts only the day and the flat she saw', async () => {
    // "Accepted" is for THIS day and flat (20260928110000): the office moving
    // it puts it back to assigned, and an accept tapped on a stale card, or
    // replayed from the queue, must not land on the moved job.
    mockResponse.data = [{ ...row, status: 'accepted' }];

    await acceptTask(SEEN);

    expect(mockSent.same).toEqual([
      ['scheduled_date', '2026-11-10'],
      ['property_id', 412432],
    ]);
  });

  test('a replay after a lost answer finds its own row instead of a refusal', async () => {
    // The first attempt got through and its answer was lost in the stairwell:
    // the row is already accepted, and the repeat has to match it.
    mockResponse.data = [{ ...row, status: 'accepted' }];

    await acceptTask(SEEN);

    expect(mockSent.from).toEqual(['assigned', 'accepted']);
  });

  test('says so when the cleaning is no longer hers to accept, or not as she saw it', async () => {
    // Zero rows: given to someone else, cancelled, moved to another day or
    // flat. Resolving quietly would leave "accepted" on a job she never saw.
    mockResponse.data = [];

    const refusal = await acceptTask(SEEN).catch((caught: unknown) => caught);

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).not.toMatch(/[а-яё]/i);
    expect(serverErrorText(refusal)).toEqual({
      text: 'Не удалось принять уборку — её могли передать, перенести или отменить.',
      detail: null,
    });
  });

  test('surfaces a transport failure rather than calling it a refusal', async () => {
    mockResponse.error = new Error('network unreachable');

    await expect(acceptTask(SEEN)).rejects.toThrow('network unreachable');
  });
});

test('reports that the task is gone when the update took no row', async () => {
  // Zero rows, not an error: the filters simply matched nothing — a colleague
  // was faster, or the server refused work past its day. Silently resolving
  // here would show the cleaner a task that is not hers.
  mockResponse.data = [];

  const refusal = await claimTask(row.id, '7c9e6679-7425-40de-944b-e07fc1f90ae7').catch(
    (caught: unknown) => caught,
  );

  // English for the logs, the reader's sentence by its key — never the
  // other way round, so a screen cannot show the log line by accident.
  expect(refusal).toBeInstanceOf(Error);
  expect((refusal as Error).message).not.toMatch(/[а-яё]/i);
  expect(serverErrorText(refusal)).toEqual({
    text: 'Уборку уже взяли, либо её срок истёк.',
    detail: null,
  });
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
    mockResponse.data = [
      { ...row, status: 'in_progress', started_at: '2026-11-10T08:00:00+00:00' },
    ];

    const started = await startTask(row.id);

    expect(started.status).toBe('in_progress');
    expect(started.started_at).not.toBeNull();
  });

  test('starts whether or not she accepted it first: accepting is a signal, not a lock', async () => {
    mockResponse.data = [
      { ...row, status: 'in_progress', started_at: '2026-11-10T08:00:00+00:00' },
    ];

    await startTask(row.id);

    expect(mockSent.patch).toEqual({ status: 'in_progress' });
    expect(mockSent.from).toEqual(['assigned', 'accepted']);
  });

  test('explains when the task could not be started', async () => {
    // Zero rows: the task is no longer assigned to her, or the server refused
    // the move — a second start with parallel work switched off, for instance.
    mockResponse.data = [];

    const refusal = await startTask(row.id).catch((caught: unknown) => caught);

    expect((refusal as Error).message).not.toMatch(/[а-яё]/i);
    expect(serverErrorText(refusal).text).toBe('Не удалось начать уборку — обновите список.');
  });
});

describe('finishTask', () => {
  test('returns the task once it is done', async () => {
    mockResponse.data = [{ ...row, status: 'done', completed_at: '2026-11-10T10:00:00+00:00' }];

    const finished = await finishTask(row.id);

    expect(finished.status).toBe('done');
    expect(mockSent.from).toEqual(['in_progress']);
  });

  test('explains when the task could not be finished', async () => {
    mockResponse.data = [];

    const refusal = await finishTask(row.id).catch((caught: unknown) => caught);

    expect((refusal as Error).message).not.toMatch(/[а-яё]/i);
    expect(serverErrorText(refusal).text).toBe('Не удалось завершить уборку — обновите список.');
  });
});
