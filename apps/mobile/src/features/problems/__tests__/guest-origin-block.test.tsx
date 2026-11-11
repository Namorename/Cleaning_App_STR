import { formatGuestDate, type GuestSource } from '@str-ops/shared';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { i18n } from '@/i18n';
import { persistOptions, shouldSaveList } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

import { GuestOriginBlock } from '../guest-origin-block';
import { problemKeys } from '../keys';
import { GUEST_ORIGIN_META, isGuestOriginMissing, retryGuestOrigin } from '../use-guest-origin';

/**
 * «Гость и проживание» on the screen of a task a guest's review or chat made
 * (owner, 2026-11-11). The server decides by role what it tells
 * (problem_guest_origin): the head technician hears the guest's name, the
 * technician and the maid only the stay. The phone shows what it is told, in
 * the panel's words (`guestOriginLines`), and keeps none of it on disk.
 */

const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const mockSession = { userId: ME as string | null };

jest.mock('@/features/auth/session', () => ({ useSession: () => mockSession }));

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

const PROBLEM_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40001';
const GUEST = 'Jana Nováková';

const DAYS = { precision: 'day', arrival: '2026-10-03', departure: '2026-10-07' } as const;

/** What the head technician is told: the stay, the guest, the channel and the rating, the day sent. */
const HEAD_TECH_ANSWER = {
  source: 'review',
  stay: DAYS,
  channel: 'airbnb',
  guest: { state: 'shown', name: GUEST },
  rating: 8,
  sent: { precision: 'day', on: '2026-10-09' },
};

/** What a technician or a maid is told: the source and the stay, nothing else. */
const TECH_ANSWER = { source: 'review', stay: DAYS };

const STAY_LINE = `Проживание: ${formatGuestDate('2026-10-03', 'day', 'ru')} – ${formatGuestDate(
  '2026-10-07',
  'day',
  'ru',
)}`;

const LOAD_FAILED = 'Не удалось загрузить сведения о госте';

let client: QueryClient;

beforeEach(() => {
  mockRpc.mockReset();
  mockSession.userId = ME;
  scheme.mockReturnValue('light');
  // The app's own retry rule is the hook's; only the wait between tries is cut.
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retryDelay: 0 } } });
});

afterEach(async () => {
  client.clear();
  await i18n.changeLanguage('ru');
});

function answers(data: unknown): void {
  mockRpc.mockResolvedValue({ data, error: null });
}

async function renderBlock(source: GuestSource | null = 'review'): Promise<void> {
  await render(<GuestOriginBlock problemId={PROBLEM_ID} source={source} />, {
    wrapper: withClient(client),
  });
}

function colorOf(text: string): TextStyle['color'] {
  return (StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle).color;
}

/** The read is over, whatever it ended in. */
async function settled(): Promise<void> {
  await waitFor(() =>
    expect(client.getQueryState(problemKeys.origin(ME, PROBLEM_ID))?.fetchStatus).toBe('idle'),
  );
  await waitFor(() =>
    expect(client.getQueryState(problemKeys.origin(ME, PROBLEM_ID))?.status).not.toBe('pending'),
  );
}

describe('the head technician', () => {
  test('sees the stay, the guest’s name, the channel with the rating and the day it was sent', async () => {
    answers(HEAD_TECH_ANSWER);

    await renderBlock();

    expect(await screen.findByText('Гость и проживание')).toBeTruthy();
    expect(screen.getByText(STAY_LINE)).toBeTruthy();
    expect(screen.getByText(`Гость: ${GUEST}`)).toBeTruthy();
    expect(screen.getByText('Airbnb · оценка 8/10')).toBeTruthy();
    expect(screen.getByText(`Отзыв от ${formatGuestDate('2026-10-09', 'day', 'ru')}`)).toBeTruthy();
    expect(colorOf(`Гость: ${GUEST}`)).toBe(Colors.light.text);
    expect(mockRpc).toHaveBeenCalledWith('problem_guest_origin', { p_problem_id: PROBLEM_ID });
  });

  test.each([
    ['erased', 'Имя удалено по сроку хранения'],
    ['cut', 'Имя и точные даты не хранятся после решения по карточке'],
    ['none', 'Бронь не найдена, имени нет'],
  ])('a name that is %s says why, in the quiet tone', async (state, why) => {
    answers({ ...HEAD_TECH_ANSWER, guest: { state, name: null } });

    await renderBlock();

    expect(await screen.findByText(why)).toBeTruthy();
    expect(colorOf(why)).toBe(Colors.light.textSecondary);
    expect(screen.queryByText(/Гость:/)).toBeNull();
  });

  test('the office’s numbers never reach the phone, whoever is signed in', async () => {
    answers({ ...HEAD_TECH_ANSWER, booking_id: '41750213', conversation_id: '9917253' });

    await renderBlock();

    expect(await screen.findByText(`Гость: ${GUEST}`)).toBeTruthy();
    expect(screen.queryByText(/41750213/)).toBeNull();
    expect(screen.queryByText(/9917253/)).toBeNull();
  });

  test.each([
    ['en', 'Guest and stay', `Guest: ${GUEST}`],
    ['cs', 'Host a pobyt', `Host: ${GUEST}`],
  ])('in %s the block says «%s» and «%s»', async (language, title, name) => {
    answers(HEAD_TECH_ANSWER);
    await i18n.changeLanguage(language);

    await renderBlock();

    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText(name)).toBeTruthy();
  });
});

describe('the technician and the maid', () => {
  test('see the stay alone, never a name', async () => {
    answers(TECH_ANSWER);

    await renderBlock();

    expect(await screen.findByText('Гость и проживание')).toBeTruthy();
    expect(screen.getByText(STAY_LINE)).toBeTruthy();
    expect(screen.queryByText(/Гость:/)).toBeNull();
    expect(screen.queryByText(GUEST, { exact: false })).toBeNull();
    expect(screen.queryByText(/Airbnb/)).toBeNull();
  });

  test('a stay cut to its months says so', async () => {
    answers({
      source: 'message',
      stay: { precision: 'month', arrival: '2026-10', departure: '2026-10' },
    });

    await renderBlock('message');

    const month = formatGuestDate('2026-10', 'month', 'ru');
    expect(await screen.findByText(`Проживание: ${month}`)).toBeTruthy();
    const why = 'Точные даты не хранятся после решения по карточке';
    expect(screen.getByText(why)).toBeTruthy();
    expect(colorOf(why)).toBe(Colors.light.textSecondary);
  });

  test('a stay nobody knows says so, in the quiet tone', async () => {
    answers({ source: 'review', stay: null });

    await renderBlock();

    expect(await screen.findByText('Даты проживания неизвестны')).toBeTruthy();
    expect(colorOf('Даты проживания неизвестны')).toBe(Colors.light.textSecondary);
  });
});

describe('when there is nothing to show', () => {
  test('a report of the staff asks nothing and draws nothing', async () => {
    answers(HEAD_TECH_ANSWER);

    await renderBlock(null);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(screen.queryByText('Гость и проживание')).toBeNull();
  });

  test('a task the server says nothing of is no block', async () => {
    answers(null);

    await renderBlock();
    await settled();

    expect(screen.queryByText('Гость и проживание')).toBeNull();
    expect(screen.queryByText(LOAD_FAILED)).toBeNull();
  });

  test('while it loads, nothing', async () => {
    mockRpc.mockReturnValue(new Promise(() => {}));

    await renderBlock();

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Гость и проживание')).toBeNull();
    expect(screen.queryByText(LOAD_FAILED)).toBeNull();
  });

  test('nobody signed in asks nothing', async () => {
    mockSession.userId = null;

    await renderBlock();

    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('a read that fails', () => {
  test('is asked once more, then one quiet line', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });

    await renderBlock();

    expect(await screen.findByText(LOAD_FAILED)).toBeTruthy();
    expect(colorOf(LOAD_FAILED)).toBe(Colors.light.textSecondary);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Гость и проживание')).toBeNull();
  });

  test.each(['PGRST202', '42883'])(
    'without the function in the cloud (%s) it is not asked again',
    async (code) => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code, message: 'Could not find the function public.problem_guest_origin' },
      });

      await renderBlock();

      expect(await screen.findByText(LOAD_FAILED)).toBeTruthy();
      await settled();
      expect(mockRpc).toHaveBeenCalledTimes(1);
    },
  );

  test('the rule: one more try, none for a missing function', () => {
    const missing = { code: 'PGRST202' };
    const other = { code: '57014' };

    expect(isGuestOriginMissing(missing)).toBe(true);
    expect(isGuestOriginMissing(new Error('network'))).toBe(false);
    expect(retryGuestOrigin(0, other)).toBe(true);
    expect(retryGuestOrigin(1, other)).toBe(false);
    expect(retryGuestOrigin(0, missing)).toBe(false);
  });
});

describe('the guest’s name on disk', () => {
  test('is never written: the read asks not to be saved, the rest is saved as before', async () => {
    // Arrange: one list the disk keeps, and the head technician's answer with the name.
    answers(HEAD_TECH_ANSWER);
    await client.fetchQuery({ queryKey: problemKeys.mine(), queryFn: () => [] });

    // Act
    await renderBlock();
    expect(await screen.findByText(`Гость: ${GUEST}`)).toBeTruthy();
    const saved = dehydrate(client, persistOptions.dehydrateOptions);

    // Assert
    const origin = client.getQueryCache().find({ queryKey: problemKeys.origin(ME, PROBLEM_ID) });
    if (origin === undefined) {
      throw new Error('the guest’s origin was never read');
    }
    expect(origin.meta).toEqual(GUEST_ORIGIN_META);
    expect(GUEST_ORIGIN_META).toEqual({ persist: false });
    expect(shouldSaveList(origin)).toBe(false);
    expect(saved.queries.map((query) => query.queryKey)).toEqual([problemKeys.mine()]);
    expect(JSON.stringify(saved)).not.toContain(GUEST);
  });
});
