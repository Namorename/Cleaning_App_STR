import { THEME_COLORS } from '@str-ops/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { contrastRatio } from '../../../../../../packages/shared/src/testing/color-math';
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
  // Each photo keeps its own promise (use-outgoing-photos.ts); this one never settles.
  useAttachPhoto: () => ({
    mutateAsync: (...args: unknown[]) => {
      mutations.attach(...args);
      return new Promise(() => {});
    },
  }),
  useRemovePhoto: () => ({ mutate: mutations.remove }),
  usePhotoUrls: () => queries.photoUrls(),
}));

import { ChatSheet } from '../chat-sheet';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null });
const failed = (error: unknown) => ({ data: undefined, isPending: false, isError: true, error });

const onClose = vi.fn();

/** The sheet about a cleaning, as «Уборки» open it. */
function renderSheet(subject: { taskId: string } | { problemId: string } = { taskId: TASK }) {
  return render(
    <ChatSheet subject={subject} about="Генеральная уборка · Vinohrady 12" onClose={onClose} />,
  );
}

const sheet = () => screen.getByRole('dialog', { name: 'Разговор' });

/**
 * Picks files as the browser's dialog hands them over, `accept` or not (a drag
 * gets past it). `userEvent.upload` also plays the dialog's blur and focus, and
 * in jsdom that hands the sheet's focus trap a target that is no element — an
 * error after the test that no browser raises.
 */
function pickFiles(...files: File[]) {
  fireEvent.change(screen.getByLabelText('Прикрепить фото'), { target: { files } });
}

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

describe('ChatSheet', () => {
  // 5.4, «Чат», variant B: the conversation slides in beside its subject and
  // says what it is about, instead of sitting at the foot of a card.
  test('is a sheet named «Разговор» that says what it is about', () => {
    renderSheet();

    expect(sheet()).toHaveTextContent('Генеральная уборка · Vinohrady 12');
  });

  test('draws the transcript with who said it and marks read what was drawn', () => {
    renderSheet();

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
    const { unmount } = renderSheet({ taskId: TASK });
    expect(sheet()).toHaveTextContent(/кому видна уборка/);
    unmount();

    renderSheet({ problemId: TASK });
    expect(sheet()).toHaveTextContent(/кому видно задание/);
  });

  // The transcript was a box of 384 px inside a card; in the sheet it takes
  // the height there is and scrolls on its own, the composer under it.
  test('the transcript fills the sheet and scrolls on its own, the composer at the foot', () => {
    renderSheet();

    const transcriptBox = screen.getByRole('list').parentElement as HTMLElement;
    expect(transcriptBox).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    expect(transcriptBox).not.toHaveClass('max-h-96');
    const composer = screen.getByLabelText('Написать…').closest('form') as HTMLElement;
    expect(transcriptBox.compareDocumentPosition(composer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // Decision 14: on a phone the sheet is the whole width, nothing scrolls sideways.
  test('takes the whole width of a phone', () => {
    renderSheet();

    expect(sheet()).toHaveClass('data-[side=right]:w-full');
    // The sheet's own three quarters would win over it otherwise.
    expect(sheet()).not.toHaveClass('data-[side=right]:w-3/4');
  });

  test('closes by its cross and by Escape', async () => {
    renderSheet();

    await userEvent.click(within(sheet()).getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // The review of 05.10: opened from a drawer's button or a menu's item — both
  // gone by the time the sheet closes — the focus fell to the page's body, and
  // a keyboard started again from the top. It goes where the caller says.
  test('closed after what opened it is gone, it hands the focus where the caller says', async () => {
    function Host() {
      const [isOpen, setIsOpen] = useState(false);
      const fallback = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" ref={fallback}>
            Действия
          </button>
          {isOpen ? (
            <ChatSheet
              subject={{ taskId: TASK }}
              about="Генеральная уборка · Vinohrady 12"
              onClose={() => setIsOpen(false)}
              returnFocus={() => fallback.current}
            />
          ) : (
            <button type="button" onClick={() => setIsOpen(true)}>
              Разговор из шторки
            </button>
          )}
        </>
      );
    }
    render(<Host />);

    await userEvent.click(screen.getByRole('button', { name: 'Разговор из шторки' }));
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Действия' })).toHaveFocus());
  });

  test('an empty thread says so and marks nothing read', () => {
    queries.messages.mockReturnValue(loaded([]));

    renderSheet();

    expect(screen.getByText('Пока ничего не написано')).toBeInTheDocument();
    expect(mutations.markRead).not.toHaveBeenCalled();
  });

  test('sends what was typed under an id minted for the draft', async () => {
    renderSheet();

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
    renderSheet();

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

    renderSheet();

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

    renderSheet();

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

    renderSheet();

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

    renderSheet();

    expect(screen.getByRole('img', { name: /Фото 1\. Загружено/ })).toHaveAttribute(
      'src',
      'https://signed/photo',
    );
  });

  test('declares the picked photos and sends them under the message id', async () => {
    mutations.send.mockImplementation((_variables, handlers) => handlers?.onSuccess?.());

    renderSheet();

    const photo = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    pickFiles(photo);

    expect(screen.getByText('1 из 4')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    const [variables] = mutations.send.mock.calls[0];
    expect(variables.mediaExpected).toBe(1);
    expect(mutations.attach).toHaveBeenCalledTimes(1);
    const [attached] = mutations.attach.mock.calls[0];
    expect(attached.messageId).toBe(variables.id);
    expect(attached.file).toBe(photo);
  });

  test('a photo alone, with no words, may be sent', () => {
    renderSheet();

    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();

    pickFiles(new File(['bytes'], 'photo.webp', { type: 'image/webp' }));

    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });

  test('a file the server would refuse is never picked up at all', () => {
    renderSheet();

    // `accept` only steers the dialog; a drag or "all files" gets past it, so
    // the refusal is tested the way it can actually happen.
    pickFiles(new File(['bytes'], 'scan.pdf', { type: 'application/pdf' }));

    expect(screen.getByRole('alert')).toHaveTextContent('только фото JPEG и WebP до 20 МБ');
    expect(screen.getByText('0 из 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  });

  test('a thread it may not open is reported, with the server words under it', () => {
    queries.thread.mockReturnValue(
      failed({ message: 'Thread not found', hint: 'serverErrors.threadNotFound' }),
    );

    renderSheet();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось открыть разговор');
    expect(alert).toHaveTextContent('Этот разговор недоступен');
    expect(screen.queryByLabelText('Написать…')).not.toBeInTheDocument();
  });
});

describe('own and others’ messages', () => {
  /** The message a text stands in. */
  const bubble = (text: string) => screen.getByText(text).closest('li') as HTMLElement;

  // They differed by a faint background alone (#f3f3f3 against #fbfbfb).
  test('own are the primary family on the right, others the neutral one on the left', () => {
    renderSheet();

    expect(bubble('Ключи в боксе')).toHaveClass('self-end', 'bg-secondary', 'border-primary/40');
    expect(bubble('Поняла, спасибо')).toHaveClass('self-start', 'bg-muted', 'border-border');
  });

  // `bg-secondary` is the theme's `secondary`, `bg-muted` its `surfaceAlt`
  // (lib/design/theme-css.ts); the words are `text`, the author's line
  // `textSecondary` (`text-muted-foreground`).
  test.each(['light', 'dark'] as const)('the words on both hold 4.5:1 in the %s theme', (name) => {
    const theme = THEME_COLORS[name];
    for (const fill of [theme.secondary, theme.surfaceAlt]) {
      expect(contrastRatio(theme.text, fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.textSecondary, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
