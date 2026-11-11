import { fetchGuestOrigin, reportProblem, updateProblem } from '../api';

const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const row = {
  id: 'c8000001-0000-4000-8000-000000000001',
  property_id: 412432,
  task_id: 'a8000001-0000-4000-8000-000000000001',
  reported_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  title: 'Кран течёт',
  description: null,
  priority: 'high',
  status: 'open',
  resolved_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-11-10T08:05:00+00:00',
};

beforeEach(() => {
  mockRpc.mockReset();
});

test('files the report under the id made on the phone, from a task', async () => {
  mockRpc.mockResolvedValue({ data: row, error: null });

  const problem = await reportProblem({
    problemId: row.id,
    title: 'Кран течёт',
    description: '',
    priority: 'high',
    taskId: row.task_id,
  });

  expect(mockRpc).toHaveBeenCalledWith('report_problem', {
    p_id: row.id,
    p_title: 'Кран течёт',
    p_description: undefined,
    p_priority: 'high',
    p_property_id: undefined,
    p_task_id: row.task_id,
  });
  expect(problem.status).toBe('open');
  expect(problem.fix_tasks).toEqual([]);
});

test('passes the server refusal through untouched, key and all', async () => {
  const refusal = Object.assign(new Error('A problem needs a title'), {
    hint: 'serverErrors.problemTitleRequired',
  });
  mockRpc.mockResolvedValue({ data: null, error: refusal });

  await expect(
    updateProblem({ problemId: row.id, title: ' ', description: '', priority: 'low' }),
  ).rejects.toBe(refusal);
});

describe('where a task from a guest came from', () => {
  const stay = { precision: 'day', arrival: '2026-10-03', departure: '2026-10-07' };

  test('asks the server for this task and reads the answer field by field', async () => {
    mockRpc.mockResolvedValue({
      data: { source: 'message', stay, guest: { state: 'shown', name: 'Jana' }, rating: 'x' },
      error: null,
    });

    const origin = await fetchGuestOrigin(row.id);

    expect(mockRpc).toHaveBeenCalledWith('problem_guest_origin', { p_problem_id: row.id });
    expect(origin).toEqual({
      source: 'message',
      stay,
      guest: { state: 'shown', name: 'Jana' },
      rating: null,
    });
  });

  test('keeps none of the office’s numbers, whoever asked', async () => {
    mockRpc.mockResolvedValue({
      data: {
        source: 'review',
        stay,
        booking_id: '41750213',
        conversation_id: '9917253',
        signal_id: 'c8000001-0000-4000-8000-000000000009',
        has_text: true,
      },
      error: null,
    });

    const origin = await fetchGuestOrigin(row.id);

    expect(origin).toEqual({ source: 'review', stay });
    expect(JSON.stringify(origin)).not.toMatch(/41750213|9917253|has_text|signal_id/);
  });

  test('a report of the staff, or a task not hers, is no answer', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(fetchGuestOrigin(row.id)).resolves.toBeNull();
  });

  test('a function the cloud does not have yet fails as itself', async () => {
    const missing = { code: 'PGRST202', message: 'Could not find the function' };
    mockRpc.mockResolvedValue({ data: null, error: missing });

    await expect(fetchGuestOrigin(row.id)).rejects.toBe(missing);
  });
});
