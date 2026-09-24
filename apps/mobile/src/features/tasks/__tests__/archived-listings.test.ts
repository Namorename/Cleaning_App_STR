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
 *
 * Archiving cancels the cleanings and stay-over cleanings nobody has started
 * (`set_property_status`, 20260924170000_archive_cancels_midstay.sql). An
 * inspection or a repair on an archived flat is not cancelled: an inspection,
 * or a repair written by hand, stays in her list until the nightly sweep
 * expires it; a repair raised from a problem is never swept
 * (20260923130000_problem_mirror_current_attempt.sql) and stays until it is
 * done or cancelled.
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

/** The kinds a reader asked for, sorted: the order of an `in` list means nothing. */
const askedKinds = () => {
  const filter = calls.flatMap((call) => call.filters).find((f) => f.startsWith('in:type='));
  return filter === undefined
    ? null
    : (JSON.parse(filter.slice('in:type='.length)) as string[]).sort();
};

test('her own list holds every kind the office can give her', async () => {
  await fetchMyTasks(CLEANER);

  // Filtered out, an inspection or a midstay assigned to her never reached her
  // and the nightly sweep closed it as expired.
  expect(askedKinds()).toEqual(['cleaning', 'inspection', 'maintenance', 'midstay']);
});

test('the open pool offers cleanings and midstays; an inspection goes by assignment only', async () => {
  await fetchFreeTasks();

  expect(askedKinds()).toEqual(['cleaning', 'midstay']);
});

test('the phone asks for tasks, never for a list of listings', async () => {
  await fetchMyTasks(CLEANER);
  await fetchFreeTasks();

  // A reader that queried `properties` directly would be a new place an
  // archived flat could surface, and would need a filter of its own.
  expect(calls.map((call) => call.table)).toEqual(['tasks', 'tasks']);
});

test('and asks each task which building it stands in, and where that is', async () => {
  await fetchMyTasks(CLEANER);

  // Since the cleanings moved onto rooms, the joined name is "1 - 2109" and
  // names no house. The house is the parent row, and the street is the
  // address — both travel with the task or the cleaner has neither.
  const select = calls.flatMap((call) => call.filters).join(' ');
  expect(select).toContain('parent:parent_id(name)');
  expect(select).toContain('address');
});
