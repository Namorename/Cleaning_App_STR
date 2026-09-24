import { describe, expect, test } from 'vitest';

import { fetchReservationGuest, fetchTasks } from '../api';

/**
 * What the list of tasks asks the server for.
 *
 * Since the cleanings of the nine multi-unit listings moved onto rooms, the
 * joined listing name of such a task is the room's own — "1 - 2109" — and
 * names no building. Everything the manager does with that row afterwards
 * depends on the house coming along with it: the card is labelled by it, and
 * the search looks for it. Composing the two in the panel is only possible if
 * the query asked for both, so that is what this suite holds.
 *
 * The hint is the FOREIGN KEY COLUMN — `parent:parent_id(name)`. Neither of
 * the other two spellings works: `properties!parent_id` walks the relation
 * backwards and answers with an empty array, and the constraint name
 * `properties_parent_id_fkey` is not in the schema cache as a hint at all.
 */
function recordingClient() {
  const selects: string[] = [];

  const builder = () => {
    const result = Promise.resolve({ data: [], error: null });
    const self: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    for (const name of ['eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'gte', 'lte', 'range']) {
      self[name] = () => self;
    }
    self.select = (columns?: unknown) => {
      if (typeof columns === 'string') {
        selects.push(columns);
      }
      return self;
    };
    return self;
  };

  // The reader is typed against the real client; the shape above is all it
  // touches, and pretending otherwise would only hide what the test drives.
  return { client: { from: () => builder() } as never, selects };
}

describe('the panel reads every task with the house it stands in', () => {
  test('the query joins the parent listing by its foreign key column', async () => {
    const { client, selects } = recordingClient();

    await fetchTasks(client);

    expect(selects.join(' ')).toContain('parent:parent_id(name)');
  });
});

const SERVER_CAP = 1000;

function taskRow(index: number): Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    property_id: 1,
    reservation_id: null,
    problem_id: null,
    type: 'cleaning',
    status: index < 2000 ? 'expired' : 'unassigned',
    priority: 0,
    assignee_id: null,
    created_by: null,
    scheduled_date: '2026-09-01',
    time_from: null,
    time_to: null,
    started_at: null,
    completed_at: null,
    measured_minutes: null,
    duration_override_min: null,
    is_parallel: false,
    is_short_measurement: null,
    notes: null,
    title: null,
    title_i18n: {},
    created_at: '2026-09-01T00:00:00Z',
    property: null,
    assignee: null,
    author: null,
  };
}

/**
 * A PostgREST stand-in with the hosted default max-rows: however much is
 * asked for, one response carries at most a thousand rows. It honours
 * `range` and answers the count when `select` asks for one.
 */
function cappedServer(total: number) {
  const all = Array.from({ length: total }, (_, index) => taskRow(index));
  const orders: string[][] = [];

  const builder = () => {
    let from = 0;
    let to = Number.POSITIVE_INFINITY;
    let withCount = false;
    const order: string[] = [];
    orders.push(order);

    const run = () => {
      const size = Math.min(to - from + 1, SERVER_CAP);
      return Promise.resolve({
        data: all.slice(from, from + size),
        error: null,
        count: withCount ? all.length : null,
      });
    };

    const self: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        run().then(resolve, reject),
    };
    self.select = (_columns: unknown, options?: { count?: string }) => {
      withCount = options?.count === 'exact';
      return self;
    };
    self.gte = () => self;
    self.order = (column: string) => {
      order.push(column);
      return self;
    };
    self.range = (start: number, end: number) => {
      from = start;
      to = end;
      return self;
    };
    return self;
  };

  return { client: { from: () => builder() } as never, orders };
}

describe('the list is read to its end, not to the server cap', () => {
  test('every task comes back when there are more than a thousand', async () => {
    // Today's cloud: 5 247 rows from HISTORY_DAYS back, most of them expired
    // duplicates, and the first thousand by date ends before today — a single
    // request would show the manager an empty "today".
    const server = cappedServer(2500);

    const tasks = await fetchTasks(server.client);

    expect(tasks).toHaveLength(2500);
    expect(tasks.at(-1)?.status).toBe('unassigned');
  });

  test('every page is sorted to a unique column, so pages neither skip nor repeat', async () => {
    const server = cappedServer(2500);

    await fetchTasks(server.client);

    expect(server.orders.length).toBeGreaterThan(1);
    for (const order of server.orders) {
      expect(order.at(-1)).toBe('id');
    }
  });
});

/**
 * Who is leaving, for the task's form. A cleaning made from a booking carries
 * the booking's Hostaway id; the guest's name is read only when the form opens,
 * not with the list, so thousands of names do not travel with every visit.
 */
function bookingServer(answer: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const chain = {
    select: (...args: unknown[]) => {
      calls.push(['select', ...args]);
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push(['eq', ...args]);
      return chain;
    },
    maybeSingle: () => Promise.resolve(answer),
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return chain;
    },
  } as never;
  return { client, calls };
}

describe('the departing guest of a task', () => {
  test('reads the booking by its Hostaway id and hands back the name', async () => {
    const server = bookingServer({ data: { id: 58123, guest_name: 'Jan Novák' }, error: null });

    const guest = await fetchReservationGuest(server.client, 58123);

    expect(guest).toEqual({ id: 58123, guest_name: 'Jan Novák' });
    expect(server.calls).toEqual([
      ['from', 'reservations'],
      ['select', 'id, guest_name'],
      ['eq', 'id', 58123],
    ]);
  });

  test('a booking that is gone reads as nothing, not as an error', async () => {
    const server = bookingServer({ data: null, error: null });

    await expect(fetchReservationGuest(server.client, 58123)).resolves.toBeNull();
  });

  test('a refusal from the server is thrown, not swallowed', async () => {
    const server = bookingServer({ data: null, error: { message: 'boom' } });

    await expect(fetchReservationGuest(server.client, 58123)).rejects.toEqual({ message: 'boom' });
  });
});
