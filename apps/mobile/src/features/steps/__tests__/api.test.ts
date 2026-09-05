import { completeStep, fetchTaskSteps, reopenStep, skipStep } from '../api';

const mockRpc = jest.fn();
const listResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve(listResponse),
        }),
      }),
    }),
  },
}));

const row = {
  id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
  task_id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
  sort_order: 1,
  type: 'task_note',
  required: true,
  title: null,
  instructions: 'a\r\n\n b \n',
  started_at: null,
  completed_at: '2026-09-05T10:00:00+00:00',
  completed_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  payload: { checked_lines: [0, 1] },
  skipped_at: null,
  skip_reason: null,
  waived_at: null,
  waive_reason: null,
  // Columns the function returns that the app does not read.
  host_id: 'a0000000-0000-4000-8000-00000000000a',
  device_completed_at: '2026-09-05T09:59:58+00:00',
};

const variables = {
  taskId: row.task_id,
  stepId: row.id,
};

beforeEach(() => {
  mockRpc.mockReset();
  listResponse.data = null;
  listResponse.error = null;
});

describe('completeStep', () => {
  test('calls the completion function with the answer and the phone time', async () => {
    mockRpc.mockResolvedValue({ data: row, error: null });

    const completed = await completeStep({
      ...variables,
      payload: { checked_lines: [0, 1] },
      deviceCompletedAt: '2026-09-05T09:59:58+00:00',
    });

    expect(mockRpc).toHaveBeenCalledWith('complete_task_step', {
      p_step_id: row.id,
      p_payload: { checked_lines: [0, 1] },
      p_device_completed_at: '2026-09-05T09:59:58+00:00',
    });
    expect(completed.completed_at).toBe('2026-09-05T10:00:00+00:00');
  });

  test('surfaces the server refusal as it is', async () => {
    // The message is written for the cleaner: the screen shows it verbatim.
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Отмечены не все строки заметки' } });

    await expect(
      completeStep({ ...variables, payload: { checked_lines: [0] }, deviceCompletedAt: 'x' }),
    ).rejects.toMatchObject({ message: 'Отмечены не все строки заметки' });
  });

  test('rejects a row that does not match the expected shape', async () => {
    mockRpc.mockResolvedValue({ data: { ...row, required: 'yes' }, error: null });

    await expect(
      completeStep({ ...variables, payload: {}, deviceCompletedAt: 'x' }),
    ).rejects.toThrow();
  });
});

describe('reopenStep and skipStep', () => {
  test('call their functions by step id', async () => {
    mockRpc.mockResolvedValue({ data: { ...row, completed_at: null }, error: null });

    await reopenStep(variables);
    await skipStep({ ...variables, reason: 'nothing to add' });

    expect(mockRpc).toHaveBeenNthCalledWith(1, 'reopen_task_step', { p_step_id: row.id });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'skip_task_step', {
      p_step_id: row.id,
      p_reason: 'nothing to add',
    });
  });
});

describe('fetchTaskSteps', () => {
  test('returns the steps in order and strips what the app does not read', async () => {
    listResponse.data = [row];

    const steps = await fetchTaskSteps(row.task_id);

    expect(steps).toHaveLength(1);
    expect(steps[0]).not.toHaveProperty('host_id');
  });

  test('reads a colleague task, hidden by row level security, as no steps', async () => {
    listResponse.data = [];

    expect(await fetchTaskSteps(row.task_id)).toEqual([]);
  });

  test('surfaces a transport failure', async () => {
    listResponse.error = new Error('network unreachable');

    await expect(fetchTaskSteps(row.task_id)).rejects.toThrow('network unreachable');
  });
});
