import { describe, expect, test } from 'vitest';

import { reportProblem, setProblemDueDate } from '@/features/problems/api';

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

  test('a critical task goes out as high with p_critical (20261115090000)', async () => {
    const { client, recorded } = fakeClient();

    await reportProblem(client, {
      problemId: ROW.id,
      title: 'Прорвало трубу',
      description: '',
      priority: 'high',
      critical: true,
      propertyId: 7,
    });

    expect(recorded.rpc?.args).toMatchObject({ p_priority: 'high', p_critical: true });
  });

  // A company that reports by catalogue (owner, 2026-11-20): the category goes to the server,
  // which names the task and sets its urgency from it, whatever the title and level sent.
  test('a category picked goes out as p_category_id', async () => {
    const { client, recorded } = fakeClient();

    await reportProblem(client, {
      problemId: ROW.id,
      title: 'Затопление',
      description: '',
      priority: 'high',
      critical: true,
      propertyId: 7,
      categoryId: 'd2e00844-d88c-4324-ab60-dbed5bb56a59',
    });

    expect(recorded.rpc?.args).toMatchObject({
      p_title: 'Затопление',
      p_category_id: 'd2e00844-d88c-4324-ab60-dbed5bb56a59',
    });
  });

  test('a typed task sends no category: the call of before', async () => {
    const { client, recorded } = fakeClient();

    await reportProblem(client, {
      problemId: ROW.id,
      title: 'Течёт кран',
      description: '',
      priority: 'normal',
      propertyId: 7,
      categoryId: null,
    });

    // Undefined is left out of the request: PostgREST takes the argument's default, null.
    expect((recorded.rpc?.args as Record<string, unknown>).p_category_id).toBeUndefined();
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

  // The day the task is to be done (owner, 2026-11-26; 20261126130000): the office plans it.
  test('a planned day goes out as p_due_on', async () => {
    const { client, recorded } = fakeClient();

    await reportProblem(client, {
      problemId: ROW.id,
      title: 'Течёт кран',
      description: '',
      priority: 'normal',
      propertyId: 7,
      dueOn: '2026-12-01',
    });

    expect(recorded.rpc?.args).toMatchObject({ p_due_on: '2026-12-01' });
  });

  test('no planned day sends no p_due_on: the call of before', async () => {
    const { client, recorded } = fakeClient();

    await reportProblem(client, {
      problemId: ROW.id,
      title: 'Течёт кран',
      description: '',
      priority: 'normal',
      propertyId: 7,
      dueOn: null,
    });

    // Undefined is left out of the request: PostgREST takes the argument's default, null.
    expect((recorded.rpc?.args as Record<string, unknown>).p_due_on).toBeUndefined();
  });
});

describe('setProblemDueDate', () => {
  test('plans the day through set_problem_due_date', async () => {
    const { client, recorded } = fakeClient();

    const problem = await setProblemDueDate(client, { problemId: ROW.id, dueOn: '2026-12-01' });

    expect(recorded.rpc).toEqual({
      name: 'set_problem_due_date',
      args: { p_id: ROW.id, p_due_on: '2026-12-01' },
    });
    expect(recorded.tableWrites).toEqual([]);
    expect(problem.id).toBe(ROW.id);
  });

  test('clears it with an explicit null: the argument has no default', async () => {
    const { client, recorded } = fakeClient();

    await setProblemDueDate(client, { problemId: ROW.id, dueOn: null });

    expect(recorded.rpc?.args).toStrictEqual({ p_id: ROW.id, p_due_on: null });
  });

  test('a day out of range is refused by the server, passed through as it came', async () => {
    const refusal = { message: 'out of range', hint: 'serverErrors.problemDueInvalid' };
    const { client } = fakeClient(refusal);

    await expect(
      setProblemDueDate(client, { problemId: ROW.id, dueOn: '2030-01-01' }),
    ).rejects.toBe(refusal);
  });
});
