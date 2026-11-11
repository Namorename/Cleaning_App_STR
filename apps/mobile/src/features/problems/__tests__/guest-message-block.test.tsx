import { QueryClient, dehydrate } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { i18n } from '@/i18n';
import { persistOptions } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

import { GuestMessageBlock } from '../guest-message-block';
import { GuestOriginBlock } from '../guest-origin-block';

/**
 * «Сообщение гостя» on the phone (owner, 2026-11-11): the head technician presses, the guest's
 * message of a chat task is read from Hostaway (guest-message-text) and shown with its day and time;
 * nothing of it is kept — not in the query cache the phone writes to disk. A technician and a maid
 * get no button: the server names the guest only to the head technician and the office.
 */

const mockRpc = jest.fn();
const mockInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: ME }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));

const PROBLEM_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40002';
const SHOW = 'Показать сообщение из Hostaway';
// Synthetic words only.
const WORDS = 'SYNTH-GUEST-TEXT: no hot water in the shower';

const MESSAGES = [
  {
    sent_at: '2026-11-10T13:50:00.000Z',
    text: 'SYNTH-GUEST-TEXT: hello?',
    attachments: 0,
    is_flagged: false,
  },
  { sent_at: '2026-11-10T14:00:00.000Z', text: WORDS, attachments: 0, is_flagged: true },
  { sent_at: '2026-11-10T14:20:00.000Z', text: null, attachments: 2, is_flagged: false },
];

const DAYS = { precision: 'day', arrival: '2026-11-08', departure: '2026-11-12' } as const;

function refusal(hint: string) {
  return {
    data: null,
    error: {
      context: { json: async () => ({ error: { message: 'refused', hint, details: null } }) },
    },
  };
}

let client: QueryClient;

beforeEach(() => {
  mockRpc.mockReset();
  mockInvoke.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retryDelay: 0 } } });
});

afterEach(async () => {
  client.clear();
  await i18n.changeLanguage('ru');
});

async function renderMessage(): Promise<void> {
  await render(<GuestMessageBlock problemId={PROBLEM_ID} />, { wrapper: withClient(client) });
}

describe('who gets the button', () => {
  test('the head technician of a chat task: the server named the guest, the button is there', async () => {
    mockRpc.mockResolvedValue({
      data: {
        source: 'message',
        stay: DAYS,
        channel: 'booking',
        guest: { state: 'shown', name: 'Synth' },
      },
      error: null,
    });
    await render(<GuestOriginBlock problemId={PROBLEM_ID} source="message" />, {
      wrapper: withClient(client),
    });
    expect(await screen.findByText(SHOW)).toBeTruthy();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('a technician or a maid: the stay alone, no button', async () => {
    mockRpc.mockResolvedValue({ data: { source: 'message', stay: DAYS }, error: null });
    await render(<GuestOriginBlock problemId={PROBLEM_ID} source="message" />, {
      wrapper: withClient(client),
    });
    expect(await screen.findByText('Гость и проживание')).toBeTruthy();
    expect(screen.queryByText(SHOW)).toBeNull();
    expect(screen.queryByText('Сообщение гостя')).toBeNull();
  });

  test('a review task has no message block, whoever reads it', async () => {
    mockRpc.mockResolvedValue({
      data: { source: 'review', stay: DAYS, guest: { state: 'shown', name: 'Synth' } },
      error: null,
    });
    await render(<GuestOriginBlock problemId={PROBLEM_ID} source="review" />, {
      wrapper: withClient(client),
    });
    expect(await screen.findByText('Гость и проживание')).toBeTruthy();
    expect(screen.queryByText(SHOW)).toBeNull();
  });
});

describe('the read', () => {
  test('nothing is asked before the press; then the messages, each with its day and time', async () => {
    mockInvoke.mockResolvedValue({ data: { data: { messages: MESSAGES } }, error: null });
    await renderMessage();
    expect(mockInvoke).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText(SHOW));

    expect(await screen.findByText(WORDS)).toBeTruthy();
    expect(mockInvoke).toHaveBeenCalledWith('guest-message-text', {
      body: { problem_id: PROBLEM_ID },
    });
    expect(
      screen.getByText(
        'Текст не хранится у нас: он прочитан из Hostaway только для этого просмотра',
      ),
    ).toBeTruthy();
    // 14:00 UTC is 15:00 in Prague in November.
    expect(screen.getByText('10 нояб. 2026 г., 15:00 · отмечено')).toBeTruthy();
    expect(screen.getByText('Без текста, вложений: 2')).toBeTruthy();
    expect(screen.queryByText(SHOW)).toBeNull();
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
  ])('refused with %s: «%s»', async (hint, words, canRetry) => {
    mockInvoke.mockResolvedValue(refusal(hint));
    await renderMessage();
    fireEvent.press(screen.getByText(SHOW));

    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.queryByText('Повторить') !== null).toBe(canRetry);
  });

  test('no network: «could not load», and a press again reads again', async () => {
    mockInvoke.mockRejectedValueOnce(new TypeError('Network request failed'));
    mockInvoke.mockResolvedValueOnce({ data: { data: { messages: MESSAGES } }, error: null });
    await renderMessage();
    fireEvent.press(screen.getByText(SHOW));

    expect(await screen.findByText('Не удалось загрузить сообщение')).toBeTruthy();
    fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByText(WORDS)).toBeTruthy();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  test('the words never reach the cache the phone saves', async () => {
    mockInvoke.mockResolvedValue({ data: { data: { messages: MESSAGES } }, error: null });
    await renderMessage();
    fireEvent.press(screen.getByText(SHOW));
    expect(await screen.findByText(WORDS)).toBeTruthy();

    const saved = JSON.stringify(dehydrate(client, persistOptions.dehydrateOptions));
    expect(saved).not.toContain('SYNTH-GUEST-TEXT');
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  test('an answer that comes after the screen closed is dropped', async () => {
    let answer: (value: unknown) => void = () => {};
    mockInvoke.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const view = await render(<GuestMessageBlock problemId={PROBLEM_ID} />, {
      wrapper: withClient(client),
    });
    fireEvent.press(screen.getByText(SHOW));
    view.unmount();
    answer({ data: { data: { messages: MESSAGES } }, error: null });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
  });

  test.each([
    [
      'en',
      'Show the message from Hostaway',
      'The message is no longer available: its retention period is over',
    ],
    ['cs', 'Zobrazit zprávu z Hostaway', 'Zpráva už není dostupná: uplynula doba uchování'],
  ])('%s', async (language, show, expired) => {
    await i18n.changeLanguage(language);
    mockInvoke.mockResolvedValue(refusal('serverErrors.guestMessageGone'));
    await renderMessage();
    fireEvent.press(screen.getByText(show));
    expect(await screen.findByText(expired)).toBeTruthy();
  });
});
