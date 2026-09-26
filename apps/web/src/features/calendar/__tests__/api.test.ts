import { describe, expect, test } from 'vitest';

import { fetchCalendarBookings } from '../api';

/**
 * What the calendar asks for bookings (docs/f10-plan.md, §1).
 *
 * The select guard sees only the column list; the filters, the order and the
 * pages are held here. A stay is on the calendar for a month when it touches
 * it: it arrives before the month ends and leaves on or after its first day —
 * a departure on the 1st is half a cell of that day. Only live bookings are
 * bars: cancelled ones, inquiries and Hostaway's expired would put up to six
 * bars on one night.
 */

interface Call {
  name: string;
  args: unknown[];
}

function recordingClient(rows: unknown[] = []) {
  const calls: Call[] = [];

  const builder = () => {
    const answer = Promise.resolve({ data: rows, error: null, count: rows.length });
    const self: Record<string, unknown> = {
      then: answer.then.bind(answer),
      catch: answer.catch.bind(answer),
      finally: answer.finally.bind(answer),
    };
    for (const name of ['select', 'lt', 'gte', 'in', 'order', 'range']) {
      self[name] = (...args: unknown[]) => {
        calls.push({ name, args });
        return self;
      };
    }
    return self;
  };

  return {
    client: {
      from: (table: string) => {
        calls.push({ name: 'from', args: [table] });
        return builder();
      },
    } as never,
    calls,
  };
}

const argsOf = (calls: readonly Call[], name: string) =>
  calls.filter((call) => call.name === name).map((call) => call.args);

describe('the bookings of a month', () => {
  test('are the live stays that touch it', async () => {
    const { client, calls } = recordingClient();

    await fetchCalendarBookings(client, '2026-09-01', '2026-10-01');

    expect(argsOf(calls, 'from')).toEqual([['reservations']]);
    expect(argsOf(calls, 'lt')).toEqual([['arrival_date', '2026-10-01']]);
    expect(argsOf(calls, 'gte')).toEqual([['departure_date', '2026-09-01']]);
    expect(argsOf(calls, 'in')).toEqual([['status', ['new', 'modified', 'ownerStay']]]);
  });

  test('come with their rooms and the "#" flag', async () => {
    const { client, calls } = recordingClient();

    await fetchCalendarBookings(client, '2026-09-01', '2026-10-01');

    const select = String(argsOf(calls, 'select')[0][0]);
    expect(select).toContain('rooms:reservation_units(property_id)');
    expect(select).toContain('is_service_booking');
  });

  // Pages overlap and lose rows on ties unless the order ends on a unique column.
  test('are read in pages, in an order that ends on the id', async () => {
    const { client, calls } = recordingClient();

    await fetchCalendarBookings(client, '2026-09-01', '2026-10-01');

    expect(argsOf(calls, 'order').map((args) => args[0])).toEqual(['arrival_date', 'id']);
    expect(argsOf(calls, 'range')).toEqual([[0, 499]]);
    expect(argsOf(calls, 'select')[0][1]).toEqual({ count: 'exact' });
  });

  test('are checked on the way in', async () => {
    const { client } = recordingClient([{ id: 1, property_id: 'not a number' }]);

    await expect(fetchCalendarBookings(client, '2026-09-01', '2026-10-01')).rejects.toThrow();
  });
});
