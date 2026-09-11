/**
 * What reaches the phone after a listing is archived.
 *
 * The panel does not hide listings from the app by filtering them — the app
 * never asks for listings at all. It asks for tasks and reads the listing name
 * off each one. What archiving does is cancel the cleanings nobody has
 * started, and the phone's readers only ever ask for open work.
 *
 * So the guarantee the app rests on is one line: `cancelled` is not an open
 * status. If it is ever added to that list, an archived flat starts appearing
 * in cleaners' schedules again — and this suite fails first.
 */

interface Recorded {
  table: string;
  filters: string[];
}

const calls: Recorded[] = [];

jest.mock('@/lib/supabase', () => {
  const record = (call: Recorded) => {
    const result = Promise.resolve({ data: [], error: null });
    const self: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    const chain = (name: string) => (column?: unknown, value?: unknown) => {
      if (typeof column === 'string') {
        call.filters.push(`${name}:${column}=${JSON.stringify(value)}`);
      }
      return self;
    };
    for (const name of [
      'select',
      'eq',
      'in',
      'neq',
      'is',
      'not',
      'order',
      'gte',
      'lte',
      'limit',
    ]) {
      self[name] = chain(name);
    }
    return self;
  };

  return {
    supabase: {
      from(table: string) {
        const call: Recorded = { table, filters: [] };
        (globalThis as { __calls?: Recorded[] }).__calls?.push(call);
        return record(call);
      },
    },
  };
});

(globalThis as { __calls?: Recorded[] }).__calls = calls;

import { fetchFreeTasks, fetchMyTasks } from '../api';

const CLEANER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

beforeEach(() => {
  calls.length = 0;
});

const statusFilter = () =>
  calls
    .flatMap((call) => call.filters)
    .filter((filter) => filter.startsWith('in:status') || filter.startsWith('eq:status'))
    .join(' ');

test('a cleaner is never handed a cancelled cleaning — the shape archiving leaves', async () => {
  await fetchMyTasks(CLEANER);

  const statuses = statusFilter();
  expect(statuses).not.toContain('cancelled');
  expect(statuses).toContain('assigned');
});

test('and the open pool does not offer one either', async () => {
  await fetchFreeTasks();

  const statuses = statusFilter();
  expect(statuses).not.toContain('cancelled');
  expect(statuses).toContain('unassigned');
});

test('the phone asks for tasks, never for a list of listings', async () => {
  await fetchMyTasks(CLEANER);
  await fetchFreeTasks();

  // A reader that queried `properties` directly would be a new place an
  // archived flat could surface, and would need a filter of its own.
  expect(calls.map((call) => call.table)).toEqual(['tasks', 'tasks']);
});
