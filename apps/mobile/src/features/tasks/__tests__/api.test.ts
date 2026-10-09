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

/** What reading the row by its id answers, after a move that matched none. */
const mockRead: { data: unknown; error: unknown } = { data: [], error: null };
/** Who the phone's session says is signed in; null for nobody. */
const mockSession: { userId: string | null } = { userId: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mockSession.userId === null ? null : { user: { id: mockSession.userId } },
        },
        error: null,
      }),
    },
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
      select: () => ({ eq: () => Promise.resolve(mockRead) }),
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
  mockRead.data = [];
  mockRead.error = null;
  mockSession.userId = null;
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

/**
 * A move replayed from the queue after its answer was lost without signal:
 * the first try landed, so the status filter now matches no row. That is not
 * «taken by somebody else» nor «could not finish» — the row is read, and a
 * row already at the move's status and hers is the move done (the
 * verification review of c466bf5..bc7dcc9, item 6). Anything else is the
 * refusal it always was.
 */
describe('a move replayed after its answer was lost', () => {
  const CLEANER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const COLLEAGUE = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

  beforeEach(() => {
    // The update matches no row: the first try already moved it.
    mockResponse.data = [];
    mockSession.userId = CLEANER;
  });

  /** The row as it reads now. */
  function rowNow(changes: Record<string, unknown>): void {
    mockRead.data = [{ ...row, ...changes }];
  }

  test('a take that already landed is hers: the task comes back', async () => {
    rowNow({ status: 'accepted', assignee_id: CLEANER });

    const claimed = await claimTask(row.id, CLEANER);

    expect(claimed.status).toBe('accepted');
    expect(claimed.assignee_id).toBe(CLEANER);
  });

  test('a take that a colleague got first is still «already taken»', async () => {
    rowNow({ status: 'accepted', assignee_id: COLLEAGUE });

    const refusal = await claimTask(row.id, CLEANER).catch((caught: unknown) => caught);

    expect(serverErrorText(refusal).text).toBe('Уборку уже взяли, либо её срок истёк.');
  });

  test('an accept that already landed, on the day and in the flat she saw, is done', async () => {
    rowNow({ status: 'accepted', assignee_id: CLEANER });

    const accepted = await acceptTask(SEEN);

    expect(accepted.status).toBe('accepted');
  });

  // Moved by the office since: hers, so not «given away or cancelled» — and
  // not accepted for a day she never saw either (night journal, review of
  // bc7dcc9..dab5237; the real client's both orders: replay-after-office-move).
  test.each([
    ['another day, back to assigned', { status: 'assigned', scheduled_date: '2026-11-11' }],
    ['another flat', { status: 'assigned', property_id: 412433 }],
    ['another day, accepted there since', { status: 'accepted', scheduled_date: '2026-11-11' }],
  ])('an accept whose job moved to %s is told it was moved', async (_, changes) => {
    rowNow({ assignee_id: CLEANER, ...changes });

    const refusal = await acceptTask(SEEN).catch((caught: unknown) => caught);

    expect((refusal as Error).message).not.toMatch(/[а-яё]/i);
    expect(serverErrorText(refusal)).toEqual({
      text: 'Уборку перенесли на другой день или в другое место — проверьте её и примите снова.',
      detail: null,
    });
  });

  test.each([
    ['given to a colleague', { status: 'assigned', assignee_id: COLLEAGUE }],
    ['cancelled', { status: 'cancelled', assignee_id: CLEANER, scheduled_date: '2026-11-11' }],
    ['still assigned on her day: refused for another reason', { assignee_id: CLEANER }],
  ])('an accept on a job %s is still «given away, moved or cancelled»', async (_, changes) => {
    rowNow(changes);

    const refusal = await acceptTask(SEEN).catch((caught: unknown) => caught);

    expect(serverErrorText(refusal).text).toBe(
      'Не удалось принять уборку — её могли передать, перенести или отменить.',
    );
  });

  test.each([
    ['moved back to assigned by the office', { status: 'assigned' }],
    ['on another day', { status: 'assigned', scheduled_date: '2026-11-12' }],
    ['already under way', { status: 'in_progress' }],
  ])('a take that landed, the job since %s, is hers: no refusal', async (_, changes) => {
    rowNow({ assignee_id: CLEANER, ...changes });

    const claimed = await claimTask(row.id, CLEANER);

    expect(claimed.assignee_id).toBe(CLEANER);
  });

  test('a start that already landed is done', async () => {
    rowNow({ status: 'in_progress', assignee_id: CLEANER });

    const started = await startTask(row.id);

    expect(started.status).toBe('in_progress');
  });

  test('a start on a cleaning a colleague is doing is still refused', async () => {
    rowNow({ status: 'in_progress', assignee_id: COLLEAGUE });

    const refusal = await startTask(row.id).catch((caught: unknown) => caught);

    expect(serverErrorText(refusal).text).toBe('Не удалось начать уборку — обновите список.');
  });

  test('a finish that already landed is done, not «could not finish»', async () => {
    rowNow({ status: 'done', assignee_id: CLEANER, completed_at: '2026-11-10T10:00:00+00:00' });

    const finished = await finishTask(row.id);

    expect(finished.status).toBe('done');
  });

  test.each([
    ['still assigned: refused for another reason', { status: 'assigned', assignee_id: CLEANER }],
    ['done by a colleague', { status: 'done', assignee_id: COLLEAGUE }],
  ])('a finish on a row %s is still refused', async (_, changes) => {
    rowNow(changes);

    const refusal = await finishTask(row.id).catch((caught: unknown) => caught);

    expect(serverErrorText(refusal).text).toBe('Не удалось завершить уборку — обновите список.');
  });

  test('a row she can no longer see is still refused', async () => {
    mockRead.data = [];

    const refusal = await finishTask(row.id).catch((caught: unknown) => caught);

    expect(serverErrorText(refusal).text).toBe('Не удалось завершить уборку — обновите список.');
  });

  test('with nobody signed in, nothing can say the row is hers: still refused', async () => {
    mockSession.userId = null;
    rowNow({ status: 'in_progress', assignee_id: CLEANER });

    const refusal = await startTask(row.id).catch((caught: unknown) => caught);

    expect(serverErrorText(refusal).text).toBe('Не удалось начать уборку — обновите список.');
  });

  // The read failing for the network is the network's: the move waits for
  // signal and is tried again, instead of failing with a refusal it may not be.
  test('a read that gets no answer fails with that, not with a refusal', async () => {
    mockRead.error = new TypeError('Network request failed');

    await expect(finishTask(row.id)).rejects.toThrow('Network request failed');
  });
});
