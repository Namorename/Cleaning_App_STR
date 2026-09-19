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

const queries = { thread: vi.fn(), messages: vi.fn(), photoUrls: vi.fn() };
const mutations = { send: vi.fn(), markRead: vi.fn(), attach: vi.fn(), remove: vi.fn() };
const sendState = { isPending: false, isError: false, error: null as unknown };

vi.mock('../use-chat', () => ({
  useThread: () => queries.thread(),
  useMessages: () => queries.messages(),
  useCurrentUserId: () => ME,
  useSendMessage: () => ({ ...sendState, mutate: mutations.send }),
  useMarkThreadRead: () => ({ mutate: mutations.markRead }),
  useAttachPhoto: () => ({ mutate: mutations.attach }),
  useRemovePhoto: () => ({ mutate: mutations.remove }),
  usePhotoUrls: () => queries.photoUrls(),
}));

import { ThreadPanel } from '../thread-panel';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null });
const failed = (error: unknown) => ({ data: undefined, isPending: false, isError: true, error });

beforeEach(() => {
  vi.clearAllMocks();
  // The transcript's dates are fixed, so the clock has to be: what a tile of a
  // photo says now depends on how old its message is.
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-18T10:10:00+00:00'));
  sendState.isError = false;
  sendState.error = null;
  queries.thread.mockReturnValue(loaded({ id: THREAD }));
  queries.messages.mockReturnValue(loaded(transcript));
  queries.photoUrls.mockReturnValue(new Map());
  // jsdom has no object URLs; the composer makes one per picked file.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:picked'),
    revokeObjectURL: vi.fn(),
  });
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

  test('a photo of somebody else with no file yet is drawn as on its way', () => {
    queries.messages.mockReturnValue(
      loaded([
        message({
          id: '88888888-8888-4888-8888-888888888888',
          author_id: HER,
          author_name: 'Maria Test',
          author_role: 'cleaner',
          body: '',
          media_expected: 1,
          task_media: [
            {
              id: '99999999-9999-4999-8999-999999999999',
              storage_path: 'host/chat/thread/99999999.jpg',
              uploaded_at: null,
              created_at: '2026-09-18T10:08:00+00:00',
            },
          ],
        }),
      ]),
    );

    render(<ThreadPanel subject={{ taskId: TASK }} />);

    expect(screen.getByText('Фото в пути')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить загрузку' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Убрать' })).not.toBeInTheDocument();
  });

  test('a photo nobody sent within the day stops being on its way', () => {
    // The sweep has taken the rows of this wordless message, so there is
    // nothing left to draw it from — and «on its way» a day later would be a
    // promise kept for ever. There is nothing to press either: the id of the
    // placeholder belongs to no row.
    queries.messages.mockReturnValue(
      loaded([
        message({
          id: '88888888-8888-4888-8888-888888888888',
          author_id: HER,
          author_name: 'Maria Test',
          author_role: 'cleaner',
          body: '',
          media_expected: 1,
          created_at: '2026-09-17T08:00:00+00:00',
        }),
      ]),
    );

    render(<ThreadPanel subject={{ taskId: TASK }} />);

    expect(screen.getByText('Срок вышел')).toBeInTheDocument();
    expect(screen.queryByText('Фото в пути')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Убрать' })).not.toBeInTheDocument();
  });

  test('a photo that arrived is a picture behind its signed link', () => {
    queries.photoUrls.mockReturnValue(
      new Map([['host/chat/thread/99999999.jpg', 'https://signed/photo']]),
    );
    queries.messages.mockReturnValue(
      loaded([
        message({
          id: '88888888-8888-4888-8888-888888888888',
          body: '',
          media_expected: 1,
          task_media: [
            {
              id: '99999999-9999-4999-8999-999999999999',
              storage_path: 'host/chat/thread/99999999.jpg',
              uploaded_at: '2026-09-18T10:09:00+00:00',
              created_at: '2026-09-18T10:08:00+00:00',
            },
          ],
        }),
      ]),
    );

    render(<ThreadPanel subject={{ taskId: TASK }} />);

    expect(screen.getByRole('img', { name: /Фото 1\. Загружено/ })).toHaveAttribute(
      'src',
      'https://signed/photo',
    );
  });

  test('declares the picked photos and sends them under the message id', async () => {
    mutations.send.mockImplementation((_variables, handlers) => handlers?.onSuccess?.());

    render(<ThreadPanel subject={{ taskId: TASK }} />);

    const photo = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Прикрепить фото'), photo);

    expect(screen.getByText('1 из 4')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    const [variables] = mutations.send.mock.calls[0];
    expect(variables.mediaExpected).toBe(1);
    expect(mutations.attach).toHaveBeenCalledTimes(1);
    const [attached] = mutations.attach.mock.calls[0];
    expect(attached.messageId).toBe(variables.id);
    expect(attached.file).toBe(photo);
  });

  test('a photo alone, with no words, may be sent', async () => {
    render(<ThreadPanel subject={{ taskId: TASK }} />);

    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();

    await userEvent.upload(
      screen.getByLabelText('Прикрепить фото'),
      new File(['bytes'], 'photo.webp', { type: 'image/webp' }),
    );

    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });

  test('a file the server would refuse is never picked up at all', async () => {
    render(<ThreadPanel subject={{ taskId: TASK }} />);

    // `accept` only steers the dialog; a drag or "all files" gets past it, so
    // the refusal is tested the way it can actually happen.
    await userEvent.upload(
      screen.getByLabelText('Прикрепить фото'),
      new File(['bytes'], 'scan.pdf', { type: 'application/pdf' }),
      { applyAccept: false },
    );

    expect(screen.getByRole('alert')).toHaveTextContent('только фото JPEG и WebP до 20 МБ');
    expect(screen.getByText('0 из 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
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
