import { describe, expect, test } from 'vitest';

import { unassignProblem } from '@/features/problems/api';

import { cancelTask } from '../api';

/**
 * A cancel from the panel lands only on a task that is still live.
 *
 * The manager's screen can be minutes old. Cancelling by id alone turned a
 * repair the technician had just finished into `cancelled`: the problem went
 * back to open, resolved_at was wiped, and the technician lost the report and
 * its chat (found 2026-09-23, migration 20260923130000). The write now carries
 * the live-status filter, and a write that matched nothing says so instead of
 * passing for success.
 */
interface Recorded {
  update: unknown;
  filters: string[];
  select: string | null;
}

function fakeClient(rows: Array<{ id: string }>, error: unknown = null) {
  const recorded: Recorded = { update: null, filters: [], select: null };

  const builder: Record<string, unknown> = {};
  builder.update = (payload: unknown) => {
    recorded.update = payload;
    return builder;
  };
  builder.eq = (column: string, value: unknown) => {
    recorded.filters.push(`eq ${column} ${String(value)}`);
    return builder;
  };
  builder.not = (column: string, operator: string, value: unknown) => {
    recorded.filters.push(`not ${column} ${operator} ${String(value)}`);
    return builder;
  };
  builder.select = (columns: string) => {
    recorded.select = columns;
    return Promise.resolve({ data: error === null ? rows : null, error });
  };

  // The writers are typed against the real client; the shape above is all
  // they touch.
  return { client: { from: () => builder } as never, recorded };
}

const writers = [
  ['cancelTask', cancelTask],
  ['unassignProblem', unassignProblem],
] as const;

describe.each(writers)('%s', (_name, write) => {
  test('writes cancelled only to a task that is still live', async () => {
    const { client, recorded } = fakeClient([{ id: 't1' }]);

    await write(client, 't1');

    expect(recorded.update).toEqual({ status: 'cancelled' });
    expect(recorded.filters).toEqual(['eq id t1', 'not status in (done,cancelled,expired)']);
    expect(recorded.select).toBe('id');
  });

  test('a task that closed meanwhile is reported, not passed for success', async () => {
    const { client } = fakeClient([]);

    await expect(write(client, 't1')).rejects.toMatchObject({
      hint: 'serverErrors.taskChangedMeanwhile',
    });
  });

  test('a refusal from the server is passed through as it came', async () => {
    const refusal = { message: 'denied', hint: 'serverErrors.taskClosed' };
    const { client } = fakeClient([], refusal);

    await expect(write(client, 't1')).rejects.toBe(refusal);
  });
});
