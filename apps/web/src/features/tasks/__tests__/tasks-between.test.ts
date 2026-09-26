import { describe, expect, test } from 'vitest';

import { fetchTasksBetween } from '../api';

/**
 * What the calendar asks for tasks (docs/f10-plan.md, §1).
 *
 * A month is a half-open range of days, so a task on the 1st belongs to one
 * month only. The classes are read apart: the live and the done under the
 * calendar's default view, the cancelled behind their switch (7.5). A repair
 * comes with its problem's title and priority for the chip.
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
    for (const name of ['select', 'gte', 'lt', 'in', 'order', 'range']) {
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

describe('the tasks of a month', () => {
  test('are the days from its first up to the first of the next', async () => {
    const { client, calls } = recordingClient();

    await fetchTasksBetween(client, '2026-09-01', '2026-10-01', 'active');

    expect(argsOf(calls, 'from')).toEqual([['tasks']]);
    expect(argsOf(calls, 'gte')).toEqual([['scheduled_date', '2026-09-01']]);
    expect(argsOf(calls, 'lt')).toEqual([['scheduled_date', '2026-10-01']]);
  });

  test('the calendar reads the live and the done together, and the cancelled apart', async () => {
    const active = recordingClient();
    const cancelled = recordingClient();

    await fetchTasksBetween(active.client, '2026-09-01', '2026-10-01', 'active');
    await fetchTasksBetween(cancelled.client, '2026-09-01', '2026-10-01', 'cancelled');

    expect(argsOf(active.calls, 'in')).toEqual([
      [
        'status',
        ['unassigned', 'assigned', 'accepted', 'in_progress', 'paused', 'blocked', 'done'],
      ],
    ]);
    expect(argsOf(cancelled.calls, 'in')).toEqual([['status', ['cancelled']]]);
  });

  test('a repair comes with its problem', async () => {
    const { client, calls } = recordingClient();

    await fetchTasksBetween(client, '2026-09-01', '2026-10-01', 'active');

    expect(String(argsOf(calls, 'select')[0][0])).toContain('problem:problem_id(title, priority)');
  });

  // Pages overlap and lose rows on ties unless the order ends on a unique column.
  test('are read in pages, in an order that ends on the id', async () => {
    const { client, calls } = recordingClient();

    await fetchTasksBetween(client, '2026-09-01', '2026-10-01', 'active');

    expect(argsOf(calls, 'order').map((args) => args[0])).toEqual([
      'scheduled_date',
      'time_from',
      'id',
    ]);
    expect(argsOf(calls, 'range')).toEqual([[0, 499]]);
    expect(argsOf(calls, 'select')[0][1]).toEqual({ count: 'exact' });
  });

  test('are checked on the way in', async () => {
    const { client } = recordingClient([{ id: 'not a uuid' }]);

    await expect(fetchTasksBetween(client, '2026-09-01', '2026-10-01', 'active')).rejects.toThrow();
  });
});
