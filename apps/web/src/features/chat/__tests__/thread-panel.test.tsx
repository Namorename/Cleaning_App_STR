import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { chatMessageSchema, type ChatMessage } from '../schema';

const TASK = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';
const ME = '66666666-6666-4666-8666-666666666666';
const HER = '77777777-7777-4777-8777-777777777777';

const message = (overrides: Partial<ChatMessage> & { id: string }): ChatMessage =>
  chatMessageSchema.parse({
    thread_id: THREAD,
    author_id: ME,
    author_name: 'Olga Manager',
    author_role: 'manager',
    body: 'Ключи в боксе',
    media_expected: 0,
    created_at: '2026-09-18T10:00:00+00:00',
    ...overrides,
  });

const transcript = [
  message({ id: '44444444-4444-4444-8444-444444444444' }),
  message({
    id: '55555555-5555-4555-8555-555555555555',
    author_id: HER,
    author_name: 'Maria Test',
    author_role: 'cleaner',
    body: 'Поняла, спасибо',
    created_at: '2026-09-18T10:07:00+00:00',
  }),
];

const queries = { thread: vi.fn(), messages: vi.fn() };
const mutations = { send: vi.fn(), markRead: vi.fn() };
const sendState = { isPending: false, isError: false, error: null as unknown };

vi.mock('../use-chat', () => ({
  useThread: () => queries.thread(),
  useMessages: () => queries.messages(),
  useCurrentUserId: () => ME,
  useSendMessage: () => ({ ...sendState, mutate: mutations.send }),
  useMarkThreadRead: () => ({ mutate: mutations.markRead }),
}));

import { ThreadPanel } from '../thread-panel';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null });
const failed = (error: unknown) => ({ data: undefined, isPending: false, isError: true, error });

beforeEach(() => {
  vi.clearAllMocks();
  sendState.isError = false;
  sendState.error = null;
  queries.thread.mockReturnValue(loaded({ id: THREAD }));
  queries.messages.mockReturnValue(loaded(transcript));
});

describe('ThreadPanel', () => {
  test('draws the transcript with who said it and marks read what was drawn', () => {
    render(<ThreadPanel subject={{ taskId: TASK }} />);

    expect(screen.getByRole('heading', { name: 'Разговор' })).toBeInTheDocument();
    expect(screen.getByText('Ключи в боксе')).toBeInTheDocument();
    expect(screen.getByText('Поняла, спасибо')).toBeInTheDocument();
    expect(screen.getByText('Maria Test')).toBeInTheDocument();
    expect(screen.getByText(/Горничная:/)).toBeInTheDocument();

    expect(mutations.markRead).toHaveBeenCalledTimes(1);
    expect(mutations.markRead).toHaveBeenCalledWith({
      threadId: THREAD,
      upTo: '2026-09-18T10:07:00+00:00',
    });
  });

  test('says who will see a task thread, and who a problem thread', () => {
    const { unmount } = render(<ThreadPanel subject={{ taskId: TASK }} />);
    expect(screen.getByText(/кому видно задание/)).toBeInTheDocument();
    unmount();

    render(<ThreadPanel subject={{ problemId: TASK }} />);
    expect(screen.getByText(/кому видна поломка/)).toBeInTheDocument();
  });

  test('an empty thread says so and marks nothing read', () => {
    queries.messages.mockReturnValue(loaded([]));

    render(<ThreadPanel subject={{ taskId: TASK }} />);

    expect(screen.getByText('Пока ничего не написано')).toBeInTheDocument();
    expect(mutations.markRead).not.toHaveBeenCalled();
  });

  test('sends what was typed under an id minted for the draft', async () => {
    render(<ThreadPanel subject={{ taskId: TASK }} />);

    const send = screen.getByRole('button', { name: 'Отправить' });
    expect(send).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Написать…'), 'Полотенца в шкафу');
    await userEvent.click(send);

    expect(mutations.send).toHaveBeenCalledTimes(1);
    const [variables] = mutations.send.mock.calls[0];
    expect(variables.body).toBe('Полотенца в шкафу');
    expect(variables.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a blank message is not sent', async () => {
    render(<ThreadPanel subject={{ taskId: TASK }} />);

    await userEvent.type(screen.getByLabelText('Написать…'), '   ');

    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    expect(mutations.send).not.toHaveBeenCalled();
  });

  test("translates the server's refusal with its parameters", () => {
    sendState.isError = true;
    sendState.error = {
      message: 'The message is too long',
      hint: 'serverErrors.messageTooLong',
      details: '{"limit":4000}',
    };

    render(<ThreadPanel subject={{ taskId: TASK }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('В сообщении не больше 4000 символов');
  });

  test('a thread it may not open is reported, with the server words under it', () => {
    queries.thread.mockReturnValue(
      failed({ message: 'Thread not found', hint: 'serverErrors.threadNotFound' }),
    );

    render(<ThreadPanel subject={{ taskId: TASK }} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось открыть разговор');
    expect(alert).toHaveTextContent('Этот разговор недоступен');
    expect(screen.queryByLabelText('Написать…')).not.toBeInTheDocument();
  });
});
