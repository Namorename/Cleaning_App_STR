import { markThreadRead, openThread, sendMessage } from '../api';

const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const TASK = '11111111-1111-4111-8111-111111111111';
const PROBLEM = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';

const thread = {
  id: THREAD,
  kind: 'task',
  task_id: TASK,
  problem_id: null,
  last_message_at: null,
  message_count: 0,
};

const message = {
  id: MESSAGE,
  thread_id: THREAD,
  author_id: '66666666-6666-4666-8666-666666666666',
  author_name: 'Maria Test',
  author_role: 'cleaner',
  body: 'Поняла, спасибо',
  media_expected: 0,
  created_at: '2026-09-18T10:01:00+00:00',
};

beforeEach(() => {
  mockRpc.mockReset();
});

test('opens the thread of a task by naming the task and nothing else', async () => {
  mockRpc.mockResolvedValue({ data: thread, error: null });

  const opened = await openThread({ kind: 'task', id: TASK });

  expect(mockRpc).toHaveBeenCalledWith('open_thread', { p_task_id: TASK });
  expect(opened.id).toBe(THREAD);
});

test('opens the thread of a problem by naming the problem and nothing else', async () => {
  mockRpc.mockResolvedValue({
    data: { ...thread, kind: 'problem', task_id: null, problem_id: PROBLEM },
    error: null,
  });

  await openThread({ kind: 'problem', id: PROBLEM });

  expect(mockRpc).toHaveBeenCalledWith('open_thread', { p_problem_id: PROBLEM });
});

test('sends under the id made on the phone, so a retry replays', async () => {
  mockRpc.mockResolvedValue({ data: message, error: null });

  const sent = await sendMessage({
    messageId: MESSAGE,
    body: 'Поняла, спасибо',
    subject: { kind: 'task', id: TASK },
  });

  expect(mockRpc).toHaveBeenCalledWith('send_message', {
    p_id: MESSAGE,
    p_body: 'Поняла, спасибо',
    p_task_id: TASK,
  });
  expect(sent.body).toBe('Поняла, спасибо');
});

test('marks read up to the moment it was given', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });

  await markThreadRead({ threadId: THREAD, upTo: '2026-09-18T10:01:00+00:00' });

  expect(mockRpc).toHaveBeenCalledWith('mark_thread_read', {
    p_thread_id: THREAD,
    p_up_to: '2026-09-18T10:01:00+00:00',
  });
});

test("hands the server's refusal up as it is", async () => {
  const refusal = { message: 'Thread not found', hint: 'serverErrors.threadNotFound' };
  mockRpc.mockResolvedValue({ data: null, error: refusal });

  await expect(openThread({ kind: 'task', id: TASK })).rejects.toBe(refusal);
});
