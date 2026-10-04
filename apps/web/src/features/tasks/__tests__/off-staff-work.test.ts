import { describe, expect, test } from 'vitest';

import { fetchOffStaffWork } from '../api';

/**
 * What the dashboard asks for the work under way of people switched off
 * (docs/staff-disable-plan.md).
 *
 * Switching an account off takes it off everything nobody has started
 * (20261004100000); what it had started stays on it for the manager to decide.
 * The repairs of tasks are the repair tiles' (fetchLiveRepairs); this reader
 * is everything else — cleanings of every kind, inspections, repairs written
 * by hand. The rule is in the query: a filter left out here would show work
 * not started, or work of people who still work, as needing a decision.
 */
function recordingClient() {
  const calls: string[] = [];

  const builder = () => {
    const result = Promise.resolve({ data: [], error: null });
    const self: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    for (const name of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'gte', 'lte']) {
      self[name] = (column?: unknown, value?: unknown) => {
        if (typeof column === 'string') {
          calls.push(`${name}:${column}=${String(value)}`);
        }
        return self;
      };
    }
    return self;
  };

  return { client: { from: () => builder() } as never, calls };
}

describe('the work under way of people switched off', () => {
  test('is started work, of somebody who no longer works here, outside the repairs of tasks', async () => {
    const { client, calls } = recordingClient();

    await fetchOffStaffWork(client);

    expect(calls).toContain('in:status=in_progress,paused,blocked');
    expect(calls).toContain('eq:assignee.is_active=false');
    expect(calls).toContain('is:problem_id=null');
  });

  test('the person is joined inner, so the filter on her switch drops the rows, not the name', async () => {
    const { client, calls } = recordingClient();

    await fetchOffStaffWork(client);

    expect(calls.join(' ')).toContain('assignee:profiles!tasks_assignee_id_fkey!inner(');
  });

  test('oldest first, and by id within a day, so the list does not reshuffle between reads', async () => {
    const { client, calls } = recordingClient();

    await fetchOffStaffWork(client);

    expect(calls.filter((call) => call.startsWith('order:'))).toEqual([
      'order:scheduled_date=[object Object]',
      'order:id=[object Object]',
    ]);
  });
});
