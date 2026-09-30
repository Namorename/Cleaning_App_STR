import { describe, expect, test } from 'vitest';

import { fetchExpiredBetween, fetchLiveRepairs, fetchTask } from '../api';

/**
 * The readers stage 7.5 adds (docs/f10-plan.md, §1): what never happened,
 * one task whole for the drawer, and the live repairs whatever their day.
 * The select guard sees only the column lists; the filters are held here.
 */

interface Call {
  name: string;
  args: unknown[];
}

function recordingClient(rows: unknown[] = [], single: unknown = null) {
  const calls: Call[] = [];

  const builder = () => {
    const answer = Promise.resolve({ data: rows, error: null, count: rows.length });
    const self: Record<string, unknown> = {
      then: answer.then.bind(answer),
      catch: answer.catch.bind(answer),
      finally: answer.finally.bind(answer),
    };
    for (const name of ['select', 'eq', 'neq', 'gte', 'lt', 'in', 'not', 'order', 'range']) {
      self[name] = (...args: unknown[]) => {
        calls.push({ name, args });
        return self;
      };
    }
    self.maybeSingle = () => {
      calls.push({ name: 'maybeSingle', args: [] });
      return Promise.resolve({ data: single, error: null });
    };
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

describe('what never happened in a month', () => {
  // Thousands of duplicate rows a month until the pre-launch reset: only what
  // a mark needs, the assignee for the assignee filter (§2), and the assignee's
  // name — somebody who left is in no other list the calendar reads.
  test('is the expired, day by day, in as few columns as a mark needs', async () => {
    const { client, calls } = recordingClient();

    await fetchExpiredBetween(client, '2026-09-01', '2026-10-01');

    expect(argsOf(calls, 'from')).toEqual([['tasks']]);
    expect(argsOf(calls, 'eq')).toEqual([['status', 'expired']]);
    expect(argsOf(calls, 'gte')).toEqual([['scheduled_date', '2026-09-01']]);
    expect(argsOf(calls, 'lt')).toEqual([['scheduled_date', '2026-10-01']]);
    expect(String(argsOf(calls, 'select')[0][0]).replace(/\s+/g, ' ')).toBe(
      'id, property_id, reservation_id, scheduled_date, type, assignee_id, ' +
        'assignee:profiles!tasks_assignee_id_fkey(full_name)',
    );
  });

  test('is read in pages, in an order that ends on the id', async () => {
    const { client, calls } = recordingClient();

    await fetchExpiredBetween(client, '2026-09-01', '2026-10-01');

    expect(argsOf(calls, 'order').map((args) => args[0])).toEqual(['scheduled_date', 'id']);
    expect(argsOf(calls, 'range')).toEqual([[0, 499]]);
  });
});

describe('one task, whole', () => {
  test('is read by its id, and a row that is not there is null, not an error', async () => {
    const { client, calls } = recordingClient();

    await expect(fetchTask(client, '11111111-1111-4111-8111-111111111111')).resolves.toBeNull();
    expect(argsOf(calls, 'eq')).toEqual([['id', '11111111-1111-4111-8111-111111111111']]);
    expect(String(argsOf(calls, 'select')[0][0])).toContain('assignee:profiles');
  });
});

describe('the live repairs', () => {
  test('are the tasks of a problem that are not closed, whatever their day', async () => {
    const { client, calls } = recordingClient();

    await fetchLiveRepairs(client);

    expect(argsOf(calls, 'from')).toEqual([['tasks']]);
    expect(argsOf(calls, 'not')).toEqual([['problem_id', 'is', null]]);
    expect(argsOf(calls, 'in')).toEqual([
      ['status', ['unassigned', 'assigned', 'accepted', 'in_progress', 'paused', 'blocked']],
    ]);
    expect(argsOf(calls, 'gte')).toEqual([]);
  });

  // The badge is red when the technician is switched off, and "overdue" is
  // counted by the listing's own day (§6).
  test('come with the technician’s switch and the listing’s zone, without the archive', async () => {
    const { client, calls } = recordingClient();

    await fetchLiveRepairs(client);

    const select = String(argsOf(calls, 'select')[0][0]);
    expect(select).toContain('assignee:profiles!tasks_assignee_id_fkey(full_name, is_active)');
    expect(select).toContain('property:properties!inner(name, status, timezone, ');
    expect(argsOf(calls, 'neq')).toEqual([['property.status', 'archived']]);
  });

  // The dashboard lists a repair by its place, and a room's own name ("1 -
  // 2109") never says which building it is in (propertyPathOf).
  test('come with what names a room: whether it is one, and its building', async () => {
    const { client, calls } = recordingClient();

    await fetchLiveRepairs(client);

    const select = String(argsOf(calls, 'select')[0][0]);
    expect(select).toContain(
      'property:properties!inner(name, status, timezone, hostaway_unit_id, parent:parent_id(name))',
    );
  });
});
