import { describe, expect, test } from 'vitest';

import { cancelTask, restoreTask } from '../api';

/**
 * The office calls off any cleaning, in any status, and returns one it called off (owner,
 * 2026-11-18; cancel_cleaning and restore_cleaning, 20261118120000). The writes are the server's:
 * it checks the role, keeps who, when and why, and refuses a repair — the panel no longer writes
 * the status by hand (the live-only filter of cancelLiveTask is gone with it).
 */
interface Recorded {
  fn: string | null;
  args: unknown;
}

function fakeClient(error: unknown = null) {
  const recorded: Recorded = { fn: null, args: null };
  const client = {
    rpc: (fn: string, args: unknown) => {
      recorded.fn = fn;
      recorded.args = args;
      return Promise.resolve({ data: null, error });
    },
  };
  // The writers are typed against the real client; rpc is all they touch.
  return { client: client as never, recorded };
}

describe('cancelTask', () => {
  test('asks the server to cancel the cleaning with the reason as typed, trimmed', async () => {
    const { client, recorded } = fakeClient();

    await cancelTask(client, { taskId: 't1', reason: '  owner cleans himself  ' });

    expect(recorded).toEqual({
      fn: 'cancel_cleaning',
      args: { p_task_id: 't1', p_reason: 'owner cleans himself' },
    });
  });

  test('sends no reason when none was typed', async () => {
    const { client, recorded } = fakeClient();

    await cancelTask(client, { taskId: 't1', reason: '   ' });

    expect(recorded.args).toEqual({ p_task_id: 't1', p_reason: undefined });
  });

  test("passes the server's refusal on as it came", async () => {
    const refusal = { message: 'denied', hint: 'serverErrors.managerOnly' };
    const { client } = fakeClient(refusal);

    await expect(cancelTask(client, { taskId: 't1', reason: '' })).rejects.toBe(refusal);
  });
});

describe('restoreTask', () => {
  test('asks the server to return the cleaning', async () => {
    const { client, recorded } = fakeClient();

    await restoreTask(client, 't1');

    expect(recorded).toEqual({ fn: 'restore_cleaning', args: { p_task_id: 't1' } });
  });

  test('a booking that has another cleaning of the place meanwhile is a refusal', async () => {
    const refusal = { message: 'taken', hint: 'serverErrors.cleaningRestoreTaken' };
    const { client } = fakeClient(refusal);

    await expect(restoreTask(client, 't1')).rejects.toBe(refusal);
  });
});
