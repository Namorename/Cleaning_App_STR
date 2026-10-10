import { i18n } from '@/i18n';

import { fetchMyDoneTasks } from '../api';
import { DONE_HISTORY_DAYS, DONE_PAGE_SIZE, doneSince } from '../done';

/**
 * «Выполненные» on «Мои» (owner, 2026-10-10): her own finished jobs of the
 * last 30 days, newest first, 20 at a time. What is checked is the read the
 * phone sends; who may read what is the server's (supabase/tests).
 */

const mockSelect = jest.fn();
/** What the read answers, once its chain of filters is awaited. */
const mockAnswer = jest.fn();
/** Every filter, order and range the read chained, in order: [method, ...arguments]. */
const mockChain: unknown[][] = [];

jest.mock('@/lib/supabase', () => {
  const chain = (): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === 'then') {
            return (onValue: (value: unknown) => unknown, onError: (error: unknown) => unknown) =>
              Promise.resolve(mockAnswer()).then(onValue, onError);
          }
          return (...args: unknown[]) => {
            mockChain.push([method, ...args]);
            return chain();
          };
        },
      },
    );
  return {
    supabase: {
      from: (table: string) => ({
        select: (columns: string) => {
          mockSelect(table, columns);
          return chain();
        },
      }),
    },
  };
});

/** The calls of one method, by name, in the order they were chained. */
function chained(method: string): unknown[][] {
  return mockChain.filter(([name]) => name === method).map(([, ...args]) => args);
}

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SINCE = '2026-09-10T22:00:00.000Z';

const DONE_ROW = {
  id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
  status: 'done',
  priority: 0,
  scheduled_date: '2026-10-09',
  due_at: null,
  assignee_id: ME,
  property_id: 412432,
  reservation_id: null,
  property: {
    name: 'CZ - Nadrazni Apt 6',
    address: 'Nádražní 6',
    hostaway_unit_id: null,
    effective_cleaner_notes: null,
    parent: null,
  },
  problem: null,
  time_from: '10:00:00',
  time_to: '15:00:00',
  guests_count: null,
  started_at: '2026-10-09T08:05:00+00:00',
  completed_at: '2026-10-09T10:40:00+00:00',
  is_parallel: false,
  type: 'cleaning',
  notes: null,
  title: null,
  title_i18n: {},
};

beforeEach(() => {
  mockChain.length = 0;
  mockSelect.mockClear();
  mockAnswer.mockReset();
});

describe('the read', () => {
  test('her own finished jobs since the start of the window, newest first, one page', async () => {
    mockAnswer.mockReturnValue({ data: [DONE_ROW], error: null });

    const rows = await fetchMyDoneTasks(ME, 1, SINCE);

    const [table, columns] = mockSelect.mock.calls[0] as [string, string];
    expect(table).toBe('tasks');
    // The same columns as her open list: the job's screen opens from either.
    expect(columns).toContain('problem:problem_id(');
    expect(columns).toContain('parent:parent_id(name)');
    expect(columns).toContain('completed_at');
    expect(chained('eq')).toEqual([
      ['assignee_id', ME],
      ['status', 'done'],
    ]);
    expect(chained('gte')).toEqual([['completed_at', SINCE]]);
    expect(chained('order')).toEqual([
      ['completed_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(chained('range')).toEqual([[DONE_PAGE_SIZE, 2 * DONE_PAGE_SIZE - 1]]);
    expect(rows.map((row) => row.id)).toEqual([DONE_ROW.id]);
  });

  test('every kind of job she was given: a technician’s repairs and inspections too', async () => {
    mockAnswer.mockReturnValue({ data: [], error: null });

    await fetchMyDoneTasks(ME, 0, SINCE);

    expect(chained('in')).toEqual([['type', ['cleaning', 'maintenance', 'inspection', 'midstay']]]);
    expect(chained('range')).toEqual([[0, DONE_PAGE_SIZE - 1]]);
  });

  test('a failed read is thrown as it came', async () => {
    const refusal = new Error('permission denied for table tasks');
    mockAnswer.mockReturnValue({ data: null, error: refusal });

    await expect(fetchMyDoneTasks(ME, 0, SINCE)).rejects.toBe(refusal);
  });
});

describe('the window: one number, said in the heading', () => {
  test('thirty days, twenty to a page', () => {
    expect(DONE_HISTORY_DAYS).toBe(30);
    expect(DONE_PAGE_SIZE).toBe(20);
  });

  test('starts at the beginning of the day thirty days back, on the phone’s clock', () => {
    const now = new Date(2026, 9, 10, 18, 45);

    expect(doneSince(now)).toBe(new Date(2026, 8, 10, 0, 0).toISOString());
  });

  test.each([
    ['ru', 'Выполненные за 30 дней'],
    ['en', 'Done in the last 30 days'],
    ['cs', 'Hotové za posledních 30 dní'],
  ])('%s names the window by the number: «%s»', (lng, heading) => {
    expect(i18n.t('tasks.done.heading', { lng, count: DONE_HISTORY_DAYS })).toBe(heading);
  });

  test.each([
    ['ru', 1, 'Выполненные за 1 день'],
    ['ru', 3, 'Выполненные за 3 дня'],
    ['cs', 3, 'Hotové za poslední 3 dny'],
    ['en', 1, 'Done in the last 1 day'],
  ])('%s says another window in its own grammar: %i', (lng, count, heading) => {
    expect(i18n.t('tasks.done.heading', { lng, count })).toBe(heading);
  });
});
