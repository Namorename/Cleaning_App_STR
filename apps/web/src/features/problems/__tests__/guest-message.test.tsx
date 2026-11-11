import type { GuestMessage, GuestMessageAsk } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';
import { ServerRefusal } from '@/lib/function-error';

// The read itself is the test's to answer; whether the block asked, and when, is recorded.
const read = vi.hoisted(() => ({
  state: vi.fn(),
  asked: [] as Array<{ ask: unknown; enabled: boolean }>,
  refetch: vi.fn(),
}));
vi.mock('../use-guest-message', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../use-guest-message')>();
  return {
    ...actual,
    useGuestMessage: (ask: GuestMessageAsk, enabled: boolean) => {
      read.asked.push({ ask, enabled });
      return { ...read.state(), refetch: read.refetch };
    },
  };
});

import { GuestMessageBlock } from '../guest-message';
import { fetchGuestMessage, guestMessageKey } from '../use-guest-message';

const TASK = { problemId: '22222222-2222-4222-8222-222222222222' } as const;
const CARD = { findingId: '44444444-4444-4444-8444-444444444444' } as const;

// Synthetic words only.
const MESSAGES: GuestMessage[] = [
  { sent_at: '2026-11-10T13:50:00.000Z', text: 'SYNTH: hello?', attachments: 0, is_flagged: false },
  { sent_at: '2026-11-10T14:00:00.000Z', text: 'SYNTH: no hot water', attachments: 1, is_flagged: true },
  { sent_at: '2026-11-10T14:20:00.000Z', text: null, attachments: 2, is_flagged: false },
];

const pending = { data: undefined, isPending: true, isError: false, isFetching: true, error: null };
const shown = { data: MESSAGES, isPending: false, isError: false, isFetching: false, error: null };
const refused = (hint?: string) => ({
  data: undefined,
  isPending: false,
  isError: true,
  isFetching: false,
  error: new ServerRefusal('refused', hint),
});

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  read.asked.length = 0;
  read.state.mockReturnValue(pending);
});
afterEach(() => vi.clearAllMocks());

describe('«Сообщение гостя»', () => {
  test('nothing is read until the button is pressed', () => {
    render(<GuestMessageBlock ask={TASK} />);

    expect(screen.getByRole('region', { name: 'Сообщение гостя' })).toBeInTheDocument();
    expect(read.asked.every((call) => !call.enabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Показать сообщение из Hostaway' }));

    expect(read.asked.at(-1)).toEqual({ ask: TASK, enabled: true });
    expect(screen.getByText('Загружаем сообщение из Hostaway…')).toBeInTheDocument();
  });

  test('shown: the note that we keep nothing, each message with its day and time, the flagged one marked', () => {
    read.state.mockReturnValue(shown);
    render(<GuestMessageBlock ask={TASK} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать сообщение из Hostaway' }));

    expect(
      screen.getByText(
        'Текст не хранится у нас: он прочитан из Hostaway только для этого просмотра',
      ),
    ).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // 14:00 UTC is 15:00 in Prague in November.
    expect(items[1]).toHaveTextContent('10 нояб. 2026 г., 15:00 · отмечено · вложений: 1');
    expect(items[1]).toHaveTextContent('SYNTH: no hot water');
    expect(items[1]).toHaveAttribute('data-flagged', 'true');
    expect(items[0]).not.toHaveTextContent('отмечено');
    expect(items[2]).toHaveTextContent('Без текста, вложений: 2');
  });

  test.each([
    ['serverErrors.guestMessageGone', 'Сообщение недоступно по сроку хранения', false],
    ['serverErrors.guestMessageUnavailable', 'Hostaway недоступен, попробуйте позже', true],
    [
      'serverErrors.guestMessageForbidden',
      'Сообщение гостя видят только менеджер и главный техник',
      false,
    ],
    [
      'serverErrors.guestMessageLimit',
      'Слишком много просмотров за 10 минут, попробуйте позже',
      true,
    ],
    ['serverErrors.guestMessageNotFound', 'Hostaway не нашёл это сообщение', false],
    [undefined, 'Не удалось загрузить сообщение', true],
  ])('refused with %s: «%s», retry %s', (hint, words, canRetry) => {
    read.state.mockReturnValue(refused(hint));
    render(<GuestMessageBlock ask={TASK} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать сообщение из Hostaway' }));

    expect(screen.getByRole('status')).toHaveTextContent(words);
    const retry = screen.queryByRole('button', { name: 'Повторить' });
    expect(retry !== null).toBe(canRetry);
    if (retry !== null) {
      fireEvent.click(retry);
      expect(read.refetch).toHaveBeenCalledTimes(1);
    }
  });

  test.each([
    [
      'en',
      'Guest’s message',
      'Show the message from Hostaway',
      'The message is no longer available: its retention period is over',
    ],
    [
      'cs',
      'Zpráva hosta',
      'Zobrazit zprávu z Hostaway',
      'Zpráva už není dostupná: uplynula doba uchování',
    ],
  ])('%s', async (language, title, button, expired) => {
    await i18n.changeLanguage(language);
    read.state.mockReturnValue(refused('serverErrors.guestMessageGone'));
    render(<GuestMessageBlock ask={CARD} />);

    expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(screen.getByRole('status')).toHaveTextContent(expired);
  });
});

describe('fetchGuestMessage', () => {
  function client(answer: { data: unknown; error: unknown }) {
    const invoke = vi.fn(async () => answer);
    return { invoke, client: { functions: { invoke } } as never };
  }

  test('asks guest-message-text by the task, or by the card, and reads its messages', async () => {
    const { invoke, client: c } = client({ data: { data: { messages: MESSAGES } }, error: null });

    await expect(fetchGuestMessage(c, TASK)).resolves.toEqual(MESSAGES);
    await fetchGuestMessage(c, CARD);

    expect(invoke).toHaveBeenNthCalledWith(1, 'guest-message-text', {
      body: { problem_id: TASK.problemId },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'guest-message-text', {
      body: { finding_id: CARD.findingId },
    });
  });

  test('a refusal comes back with its key, for the block to name the state', async () => {
    const body = {
      error: { message: 'The time is over', hint: 'serverErrors.guestMessageGone', details: null },
    };
    const { client: c } = client({ data: null, error: { context: { json: async () => body } } });

    await expect(fetchGuestMessage(c, TASK)).rejects.toMatchObject({
      name: 'ServerRefusal',
      hint: 'serverErrors.guestMessageGone',
    });
  });

  test('an answer without a message is a failure, not an empty block', async () => {
    const { client: c } = client({ data: { data: { messages: [] } }, error: null });
    await expect(fetchGuestMessage(c, TASK)).rejects.toBeInstanceOf(ServerRefusal);
  });

  test('a task and a card are read and kept apart', () => {
    expect(guestMessageKey(TASK)).not.toEqual(guestMessageKey(CARD));
  });
});
