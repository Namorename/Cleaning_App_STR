import { fireEvent, render, screen } from '@testing-library/react-native';

import { chatMessageSchema, type ChatMessage } from '../schema';
import { ThreadView } from '../thread-view';

const THREAD = '33333333-3333-4333-8333-333333333333';
const ME = '66666666-6666-4666-8666-666666666666';
const MANAGER = '77777777-7777-4777-8777-777777777777';

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return chatMessageSchema.parse({
    thread_id: THREAD,
    author_id: MANAGER,
    author_name: 'Olga Manager',
    author_role: 'manager',
    body: 'Ключи в боксе',
    media_expected: 0,
    created_at: '2026-09-18T10:00:00+00:00',
    ...overrides,
  });
}

const transcript = [
  message({ id: '44444444-4444-4444-8444-444444444444' }),
  message({
    id: '55555555-5555-4555-8555-555555555555',
    author_id: ME,
    author_name: 'Maria Test',
    author_role: 'cleaner',
    body: 'Поняла, спасибо',
    created_at: '2026-09-18T10:07:00+00:00',
  }),
];

const onSend = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

test('draws the transcript, naming the others and not herself', async () => {
  await render(
    <ThreadView
      messages={transcript}
      pending={[]}
      currentUserId={ME}
      error={null}
      onSend={onSend}
    />,
  );

  expect(screen.getByText('Ключи в боксе')).toBeTruthy();
  expect(screen.getByText('Olga Manager')).toBeTruthy();
  expect(screen.getByText('Поняла, спасибо')).toBeTruthy();
  expect(screen.queryByText('Maria Test')).toBeNull();
});

test('sends what was typed and clears the box; a blank message is not sent', async () => {
  await render(
    <ThreadView
      messages={transcript}
      pending={[]}
      currentUserId={ME}
      error={null}
      onSend={onSend}
    />,
  );

  const send = screen.getByRole('button', { name: 'Отправить' });
  await fireEvent.press(send);
  expect(onSend).not.toHaveBeenCalled();

  const box = screen.getByLabelText('Написать…');
  await fireEvent.changeText(box, '   ');
  await fireEvent.press(send);
  expect(onSend).not.toHaveBeenCalled();

  await fireEvent.changeText(box, 'Полотенца в шкафу');
  await fireEvent.press(send);
  expect(onSend).toHaveBeenCalledWith('Полотенца в шкафу');
  expect(box.props.value).toBe('');
});

test('shows what is still on its way under the transcript, once', async () => {
  await render(
    <ThreadView
      messages={transcript}
      pending={[
        { id: '88888888-8888-4888-8888-888888888888', body: 'Уже иду' },
        // Confirmed meanwhile: the server's copy is in the transcript above.
        { id: '55555555-5555-4555-8555-555555555555', body: 'Поняла, спасибо' },
      ]}
      currentUserId={ME}
      error={null}
      onSend={onSend}
    />,
  );

  expect(screen.getByText('Уже иду')).toBeTruthy();
  expect(screen.getAllByText('Поняла, спасибо')).toHaveLength(1);
  expect(screen.getAllByLabelText('Отправляется…')).toHaveLength(1);
});

test('draws the photos: a hole for a file on its way, retry and remove for her own failed one', async () => {
  const onRetry = jest.fn();
  const onRemove = jest.fn();
  const photo = (id: string) => ({
    id,
    storage_path: `host/chat/thread/${id}.jpg`,
    uploaded_at: null,
    created_at: '2026-09-18T10:00:01+00:00',
  });
  const withPhotos = [
    message({
      id: '44444444-4444-4444-8444-444444444444',
      task_media: [photo('a1111111-1111-4111-8111-111111111111')],
    }),
    message({
      id: '55555555-5555-4555-8555-555555555555',
      author_id: ME,
      body: '',
      task_media: [photo('a2222222-2222-4222-8222-222222222222')],
    }),
  ];

  await render(
    <ThreadView
      messages={withPhotos}
      pending={[]}
      currentUserId={ME}
      error={null}
      onSend={onSend}
      onRetryMedia={onRetry}
      onRemoveMedia={onRemove}
    />,
  );

  expect(screen.getByLabelText('Фото 1. Фото в пути')).toBeTruthy();
  expect(screen.getByLabelText('Фото 1. Не загрузилось')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(onRetry).toHaveBeenCalledWith(
    'a2222222-2222-4222-8222-222222222222',
    '55555555-5555-4555-8555-555555555555',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));
  expect(onRemove).toHaveBeenCalledWith(
    'a2222222-2222-4222-8222-222222222222',
    '55555555-5555-4555-8555-555555555555',
  );
});

test('a photo alone is enough to send, and the gallery is offered without a switch', async () => {
  const draft = {
    id: 'd1',
    kind: 'photo' as const,
    uri: 'file:///kept/d1.jpg',
    mimeType: 'image/jpeg',
    byteSize: 1,
    width: null,
    height: null,
    durationSec: null,
    takenAt: '2026-09-18T10:00:00+00:00',
  };

  await render(
    <ThreadView
      messages={transcript}
      pending={[]}
      currentUserId={ME}
      error={null}
      onSend={onSend}
      drafts={[draft]}
      onTakePhoto={jest.fn()}
      onPickPhoto={jest.fn()}
      onDiscardDraft={jest.fn()}
    />,
  );

  expect(screen.getByRole('button', { name: 'Выбрать фото из галереи' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
  expect(onSend).toHaveBeenCalledWith('');
});

test('an empty thread says so, and a refusal is translated with its parameters', async () => {
  await render(
    <ThreadView
      messages={[]}
      pending={[]}
      currentUserId={ME}
      error={
        {
          message: 'The message is too long',
          hint: 'serverErrors.messageTooLong',
          details: '{"limit":4000}',
        } as unknown as Error
      }
      onSend={onSend}
    />,
  );

  expect(screen.getByText('Пока ничего не написано')).toBeTruthy();
  expect(screen.getByText('В сообщении не больше 4000 символов')).toBeTruthy();
});
