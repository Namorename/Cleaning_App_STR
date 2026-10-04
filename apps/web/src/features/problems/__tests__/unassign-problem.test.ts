import { describe, expect, test } from 'vitest';

import { unassignProblem } from '@/features/problems/api';

/**
 * «Снять» goes through the server's unassign_problem (20261003130000), not a
 * direct write of the task: the journal then says the technician was taken
 * off (taken_off), and the person hears «Работу сняли с вас» rather than «Работа
 * отменена» (docs/tech-plan.md §12, step 5). The screen passes the person it
 * showed, so a screen older than a hand-over refuses instead of taking off
 * someone else (serverErrors.taskChangedMeanwhile).
 */
interface Recorded {
  rpc: { name: string; args: unknown } | null;
  tableWrites: string[];
}

function fakeClient(error: unknown = null) {
  const recorded: Recorded = { rpc: null, tableWrites: [] };
  const client = {
    rpc: (name: string, args: unknown) => {
      recorded.rpc = { name, args };
      return Promise.resolve({ data: error === null ? { id: 'p1' } : null, error });
    },
    from: (table: string) => {
      recorded.tableWrites.push(table);
      throw new Error(`unexpected direct write to ${table}`);
    },
  };
  // unassignProblem is typed against the real client; the shape above is all it touches.
  return { client: client as never, recorded };
}

describe('unassignProblem', () => {
  test('asks the server to take off the person the screen showed', async () => {
    const { client, recorded } = fakeClient();

    await unassignProblem(client, 't1', 'u1');

    expect(recorded.rpc).toEqual({
      name: 'unassign_problem',
      args: { p_task_id: 't1', p_expected_assignee: 'u1' },
    });
    expect(recorded.tableWrites).toEqual([]);
  });

  test('an attempt with nobody on it is sent without an expected person', async () => {
    const { client, recorded } = fakeClient();

    await unassignProblem(client, 't1', null);

    expect(recorded.rpc).toEqual({
      name: 'unassign_problem',
      args: { p_task_id: 't1', p_expected_assignee: undefined },
    });
  });

  test('a refusal from the server is passed through as it came', async () => {
    const refusal = { message: 'changed', hint: 'serverErrors.taskChangedMeanwhile' };
    const { client } = fakeClient(refusal);

    await expect(unassignProblem(client, 't1', 'u1')).rejects.toBe(refusal);
  });
});
