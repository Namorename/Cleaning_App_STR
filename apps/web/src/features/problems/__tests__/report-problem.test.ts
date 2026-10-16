import { describe, expect, test } from 'vitest';

import { reportProblem } from '@/features/problems/api';

/**
 * «Новое задание» in the panel writes through the same idempotent RPC the
 * phone uses (report_problem, 20260908130000): the id is the panel's, so a
 * press repeated after a lost answer hands back the same row instead of a
 * second task. The server lets a manager report on any listing of the company
 * (resolve_report_property: `is_manager()`).
 */
const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  property_id: 7,
  task_id: null,
  reported_by: '22222222-2222-4222-8222-222222222222',
  title: 'Течёт кран',
  description: null,
  priority: 'high',
  status: 'open',
  resolved_at: null,
  cancelled_at: null,
  cancel_reason: null,
  archived_at: null,
  created_at: '2026-10-10T08:00:00+00:00',
};

interface Recorded {
  rpc: { name: string; args: unknown } | null;
  tableWrites: string[];
}

function fakeClient(error: unknown = null) {
  const recorded: Recorded = { rpc: null, tableWrites: [] };
  const client = {
    rpc: (name: string, args: unknown) => {
      recorded.rpc = { name, args };
      return Promise.resolve({ data: error === null ? ROW : null, error });
    },
    from: (table: string) => {
      recorded.tableWrites.push(table);
      throw new Error(`unexpected direct write to ${table}`);
    },
  };
  // reportProblem is typed against the real client; the shape above is all it touches.
  return { client: client as never, recorded };
}

describe('reportProblem', () => {
  test('sends the panel’s id with what the manager wrote, through the RPC only', async () => {
    const { client, recorded } = fakeClient();

    const problem = await reportProblem(client, {
      problemId: ROW.id,
      title: 'Течёт кран',
      description: 'Под раковиной',
      priority: 'high',
      propertyId: 7,
    });

    expect(recorded.rpc).toEqual({
      name: 'report_problem',
      args: {
        p_id: ROW.id,
        p_title: 'Течёт кран',
        p_description: 'Под раковиной',
        p_priority: 'high',
        p_property_id: 7,
      },
    });
    expect(recorded.tableWrites).toEqual([]);
    expect(problem.id).toBe(ROW.id);
  });

  test('an empty description and no listing are left to the server’s defaults', async () => {
    const { client, recorded } = fakeClient();

    await reportProblem(client, {
      problemId: ROW.id,
      title: 'Течёт кран',
      description: '',
      priority: 'normal',
      propertyId: null,
    });

    expect(recorded.rpc?.args).toEqual({
      p_id: ROW.id,
      p_title: 'Течёт кран',
      p_description: undefined,
      p_priority: 'normal',
      p_property_id: undefined,
    });
  });

  test('a refusal from the server is passed through as it came', async () => {
    const refusal = { message: 'too long', hint: 'serverErrors.problemTitleTooLong' };
    const { client } = fakeClient(refusal);

    await expect(
      reportProblem(client, {
        problemId: ROW.id,
        title: 'x',
        description: '',
        priority: 'normal',
        propertyId: null,
      }),
    ).rejects.toBe(refusal);
  });
});
