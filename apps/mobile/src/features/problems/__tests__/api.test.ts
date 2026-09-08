import { reportProblem, updateProblem } from '../api';

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
