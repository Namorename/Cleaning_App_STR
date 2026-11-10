import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { formatDateTime, formatDay } from '@/lib/format-date';
import { ServerRefusal } from '@/lib/function-error';

import { EMPTY_REVIEW_FILTERS, type ReviewFilters } from '../review-filters';
import {
  chatFreshness,
  expectedStages,
  findingAge,
  findingSchema,
  freshness,
  reviewSchema,
  textsFromDay,
  type Finding,
  type Review,
  type RunStatus,
} from '../schema';

// Synthetic findings only. The hooks are mocked: what is tested is what the
// manager sees and what each lever sends (docs/reviews-to-tasks.md §4.4–4.7,
// docs/guest-signals.md §7.2).

const FINDING_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';
const TECH_ID = '33333333-3333-4333-8333-333333333333';
const OPEN_ID = '44444444-4444-4444-8444-444444444444';

function finding(overrides: Record<string, unknown> = {}): Finding {
  return findingSchema.parse({
    id: FINDING_ID,
    signal_id: REVIEW_ID,
    property_id: 7,
    kind: 'repair',
    subject: 'hot_water',
    urgency: 'high',
    summary: 'Нет горячей воды в душе',
    summary_i18n: {
      en: 'No hot water in the shower',
      cs: 'Ve sprše neteče teplá voda',
      ru: 'Нет горячей воды в душе',
    },
    evidence: 'The shower had no hot water.',
    evidence_source: 'public',
    confidence: 0.9,
    detector: 'claude-haiku-5-5@prompt-v1',
    status: 'candidate',
    reject_reason: null,
    problem_id: null,
    decided_mode: null,
    decided_at: null,
    created_at: '2026-10-14T06:20:00Z',
    place: { name: 'Vinohrady 12' },
    signal: {
      id: REVIEW_ID,
      channel: 'airbnb',
      rating: 6,
      category_ratings: { cleanliness: 10 },
      arrival_date: '2026-10-10',
      departure_date: '2026-10-13',
      submitted_at: '2026-10-14T09:00:00Z',
      stay_exact: true,
      external_reservation_id: '80000001',
      property_id: 7,
      public_text: 'The shower had no hot water. [GUEST] was told.',
    },
    ...overrides,
  });
}

const state = {
  findings: [finding()],
  place: [] as unknown[],
  settings: {
    sync_enabled: true,
    texts_enabled: false,
    tasks_enabled: false,
    model_enabled: false,
    auto_kinds: ['repair'],
    daily_model_cap: 50,
    daily_auto_cap: 5,
    min_confidence: 0.6,
    notice_published_at: null as string | null,
    texts_enabled_at: null as string | null,
  },
};
const approve = vi.fn();
const reject = vi.fn();
const update = vi.fn();
const idle = { isPending: false, isError: false, error: null };
const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null });

/** What «Все отзывы» asked for, in order: the filters and the page of every read. */
const reviewReads: { filters: ReviewFilters; page: number }[] = [];
/** The texts asked of the PMS on the fly, and what the function answers. */
const textReads: { signalId: string; enabled: boolean }[] = [];
const liveText: { data: unknown; error: Error | null } = { data: null, error: null };
const refetchText = vi.fn();
const reviews = { rows: [] as Review[], total: 0 };
/** What signal_run_status() answers, or how its read failed. */
const runs: { rows: RunStatus; error: Error | null } = { rows: [], error: null };
/** Whether chats are on, and what signal_run_status() answers for them. */
const chats: { on: boolean; rows: RunStatus } = { on: false, rows: [] };

vi.mock('../use-guest-signals', () => ({
  useFindings: () => loaded(state.findings),
  useCandidateCount: () => loaded(state.findings.length),
  useChatsOn: () => loaded(chats.on),
  useReviewPage: (filters: ReviewFilters, page: number) => {
    reviewReads.push({ filters, page });
    return {
      ...loaded({ reviews: reviews.rows, total: reviews.total, page }),
      isPlaceholderData: false,
    };
  },
  useHasReviewText: () => false,
  useReviewText: (signalId: string, enabled: boolean) => {
    textReads.push({ signalId, enabled });
    if (!enabled) {
      return { data: undefined, isPending: true, isError: false, error: null };
    }
    return liveText.error === null
      ? loaded(liveText.data)
      : {
          data: undefined,
          isPending: false,
          isError: true,
          error: liveText.error,
          isFetching: false,
          refetch: refetchText,
        };
  },
  usePlaceProblems: () => loaded(state.place),
  useSignalSettings: () => loaded(state.settings),
  useRunStatus: (kind = 'review') =>
    kind === 'message'
      ? loaded(chats.rows)
      : runs.error === null
        ? loaded(runs.rows)
        : { data: undefined, isPending: false, isError: true, error: runs.error },
  useApproveFinding: () => ({ ...idle, mutate: approve }),
  useRejectFinding: () => ({ ...idle, mutate: reject }),
  useAddFinding: () => ({ ...idle, mutate: vi.fn() }),
  useUpdateSettings: () => ({ ...idle, mutate: update }),
}));
vi.mock('@/features/problems/use-problems', () => ({
  useStaff: () => loaded([{ id: TECH_ID, full_name: 'Petr Fixer', role: 'tech' }]),
}));
vi.mock('@/features/analytics/use-analytics', () => ({
  useAnalyticsListings: () =>
    loaded([
      { id: 7, name: 'Vinohrady 12', status: 'active' },
      { id: 9, name: 'Old Town 3', status: 'archived' },
      // More than a short list: «all ticked» means «all» only for a long one.
      ...[21, 22, 23, 24, 25, 26, 27].map((id) => ({ id, name: `Flat ${id}`, status: 'active' })),
    ]),
}));

// The router reads the address jsdom holds; the screen writes it through
// history, as on «Уборки» (tasks-view.test.tsx).
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (onChange: () => void) => {
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  };
  return {
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    usePathname: () => window.location.pathname,
  };
});

import { GuestSignalsView } from '../guest-signals-view';

/** The query of the page's address, without its `?`. */
const query = () => window.location.search.slice(1);

function review(overrides: Record<string, unknown> = {}): Review {
  return reviewSchema.parse({
    id: REVIEW_ID,
    channel: 'booking',
    rating: 5,
    category_ratings: { cleanliness: 5, location: 10 },
    arrival_date: '2026-09-01',
    departure_date: '2026-09-01',
    submitted_at: '2026-08-31T22:00:00Z',
    stay_exact: false,
    property_id: 7,
    has_public_text: true,
    place: { name: 'Vinohrady 12' },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  chats.on = false;
  chats.rows = [];
  window.history.replaceState(null, '', '/guests');
  reviewReads.length = 0;
  reviews.rows = [];
  reviews.total = 0;
  textReads.length = 0;
  liveText.data = null;
  liveText.error = null;
  runs.rows = [];
  runs.error = null;
  state.findings = [finding()];
  state.place = [];
  state.settings = {
    ...state.settings,
    texts_enabled: false,
    notice_published_at: null,
    texts_enabled_at: null,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the «Гости» screen', () => {
  test('a candidate shows what was found, where, from which stay, and the fragment', () => {
    render(<GuestSignalsView isAdmin={false} />);
    const card = screen.getByRole('article');

    expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent(
      'Ремонт · горячая вода',
    );
    expect(card).toHaveTextContent('Vinohrady 12');
    expect(card).toHaveTextContent('«Нет горячей воды в душе»');
    expect(card).toHaveTextContent('Airbnb');
    expect(card).toHaveTextContent('6/10');
    expect(card).toHaveTextContent('Бронь в PMS № 80000001');
    expect(card).toHaveTextContent('The shower had no hot water.');
    expect(screen.getByRole('tab', { name: /Найдено 1/ })).toBeInTheDocument();
  });

  test('once the stay is cut, the card shows its month and no booking', () => {
    state.findings = [
      finding({
        signal: {
          ...finding().signal,
          stay_exact: false,
          arrival_date: '2026-10-01',
          departure_date: '2026-10-01',
          external_reservation_id: null,
        },
      }),
    ];
    render(<GuestSignalsView isAdmin={false} />);
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('Проживание: 2026-10 (точных дат уже нет)');
    expect(card).not.toHaveTextContent('Бронь в PMS');
  });

  test('a candidate tells how long it has waited; a decided card, or one cut to its month, does not', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const { unmount } = render(<GuestSignalsView isAdmin={false} />);
    expect(screen.getByRole('article')).toHaveTextContent('Найдено 3 дня назад');
    unmount();

    state.findings = [
      finding({ status: 'task_created' }),
      finding({
        id: '66666666-6666-4666-8666-666666666666',
        created_at: '2026-09-30T22:00:00Z',
        signal: { ...finding().signal, stay_exact: false, external_reservation_id: null },
      }),
    ];
    render(<GuestSignalsView isAdmin={false} />);
    for (const card of screen.getAllByRole('article')) {
      expect(card).not.toHaveTextContent('Найдено');
    }
  });

  test('«Создать и отправить» sends the technician the manager picked, with the model’s own words', async () => {
    render(<GuestSignalsView isAdmin={false} />);
    await userEvent.selectOptions(screen.getByLabelText('Кому'), TECH_ID);
    await userEvent.type(
      screen.getByLabelText('Заметка для техника'),
      'Spare kettle in the storeroom',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Создать и отправить' }));

    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: FINDING_ID,
        title: undefined,
        priority: 'high',
        assigneeId: TECH_ID,
        description: 'Spare kettle in the storeroom',
      }),
    );
  });

  test('a rules card has no words: the manager writes the title, and it goes as written', async () => {
    state.findings = [
      finding({ summary: 'hot_water', summary_i18n: {}, detector: 'rules-v1', evidence: null }),
    ];
    render(<GuestSignalsView isAdmin={false} />);
    expect(screen.getByRole('article')).toHaveTextContent(
      'Формулировки нет — напишите заголовок сами',
    );

    const title = screen.getByLabelText('Заголовок задания');
    await userEvent.clear(title);
    await userEvent.type(title, 'Boiler check');
    await userEvent.click(screen.getByRole('button', { name: 'Создать задание' }));
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Boiler check', assigneeId: undefined }),
    );
  });

  test('«Это то же самое» links the open task on the place; «Отклонить» sends the reason', async () => {
    state.place = [
      {
        id: OPEN_ID,
        title: 'Boiler broken',
        title_i18n: null,
        source: 'staff',
        status: 'open',
        created_at: '2026-10-14T10:00:00Z',
        resolved_at: null,
        is_open: true,
        can_link: true,
      },
    ];
    render(<GuestSignalsView isAdmin={false} />);
    await userEvent.selectOptions(screen.getByLabelText('То же самое или уже починено'), OPEN_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    expect(approve).toHaveBeenCalledWith({ findingId: FINDING_ID, linkProblemId: OPEN_ID });

    await userEvent.selectOptions(screen.getByLabelText('Причина'), 'not_worth');
    await userEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(reject).toHaveBeenCalledWith({ findingId: FINDING_ID, reason: 'not_worth' });
  });

  test('the switches are the admin’s; a manager may still take a kind out of auto', async () => {
    const { unmount } = render(<GuestSignalsView isAdmin={false} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    expect(screen.getByText('Эти выключатели меняет только админ.')).toBeInTheDocument();
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toHaveAttribute('aria-disabled', 'true');
    }
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть на одобрение' }));
    expect(update).toHaveBeenCalledWith({ autoKinds: [] });
    unmount();

    render(<GuestSignalsView isAdmin />);
    await userEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  // P6 (docs/guest-signals.md §2.4): the core never reads a PMS's column; a
  // room is a place with a parent, and is named under its house.
  test('a room is named under its house, from its parent alone', () => {
    state.findings = [
      finding({ place: { name: '1 - 2109', parent_id: 10, parent: { name: 'Royal House' } } }),
    ];
    render(<GuestSignalsView isAdmin={false} />);

    expect(screen.getByRole('article')).toHaveTextContent('Royal House — 1 - 2109');
  });

  // The owner's decisions of 2026-11-01 and 2026-11-02 (20261102100000): texts
  // go on without the guest notice; the card shows the day they are kept from.
  test('the texts switch asks for no guest notice, and the card names the day texts are kept from', async () => {
    const { unmount } = render(<GuestSignalsView isAdmin />);
    await userEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    expect(screen.getByText('Хранить тексты отзывов')).toBeInTheDocument();
    expect(screen.queryByText(/уведомлен/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Тексты будут храниться по проживаниям с заездом не раньше дня, когда их впервые включат',
      ),
    ).toBeInTheDocument();
    unmount();

    state.settings = {
      ...state.settings,
      texts_enabled: true,
      texts_enabled_at: '2026-11-02T09:30:00Z',
    };
    const { unmount: unmount2 } = render(<GuestSignalsView isAdmin />);
    await userEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    expect(
      screen.getByText(
        `Тексты хранятся по проживаниям с заездом не раньше ${formatDay('2026-11-02', 'ru')}`,
      ),
    ).toBeInTheDocument();
    unmount2();
  });

  test('texts switched off keep their day, and the card does not claim texts are kept', async () => {
    state.settings = {
      ...state.settings,
      texts_enabled: false,
      texts_enabled_at: '2026-11-02T09:30:00Z',
    };
    render(<GuestSignalsView isAdmin />);
    await userEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    expect(
      screen.getByText(
        `Тексты выключены; если включить снова — по проживаниям с заездом не раньше ${formatDay('2026-11-02', 'ru')}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Тексты хранятся/)).not.toBeInTheDocument();
  });

  test('the ceiling of auto’s tasks a day is the admin’s to change, within its bounds', async () => {
    const { unmount } = render(<GuestSignalsView isAdmin={false} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    expect(screen.getByLabelText('Заданий «сразу» в сутки не больше')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    unmount();

    render(<GuestSignalsView isAdmin />);
    await userEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    const cap = screen.getByLabelText('Заданий «сразу» в сутки не больше');
    expect(cap).toHaveValue(5);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await userEvent.clear(cap);
    await userEvent.type(cap, '60');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await userEvent.clear(cap);
    await userEvent.type(cap, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(update).toHaveBeenCalledWith({ dailyAutoCap: 3 });
  });
});

describe('«Все отзывы»', () => {
  test('lists a page with the number of reviews found, the ratings by category and the place', async () => {
    reviews.rows = [review()];
    reviews.total = 1234;
    render(<GuestSignalsView isAdmin={false} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Все отзывы' }));

    expect(query()).toBe('tab=all');
    // 1 234 is a "few" in Russian; the number is spelled as the panel's language spells it.
    expect(screen.getByText(/^1\s234 отзыва$/)).toBeInTheDocument();
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Vinohrady 12');
    expect(row).toHaveTextContent('5/10');
    expect(row).toHaveTextContent('Booking.com');
    expect(row).toHaveTextContent('чистота 5 · расположение 10');
    expect(reviewReads.at(-1)).toEqual({ filters: EMPTY_REVIEW_FILTERS, page: 0 });
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Предыдущая страница' })).toBeDisabled();
  });

  test('the filters go into the address and to the server, and one button clears them all', async () => {
    reviews.rows = [review()];
    reviews.total = 1;
    render(<GuestSignalsView isAdmin={false} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Все отзывы' }));

    await userEvent.click(screen.getByRole('button', { name: 'Низкие (6 и ниже)' }));
    await userEvent.click(screen.getByLabelText('Есть приватный комментарий'));
    await userEvent.selectOptions(
      screen.getByLabelText('Низкая оценка по категории'),
      'cleanliness',
    );

    expect(new URLSearchParams(query()).get('rmax')).toBe('6');
    expect(new URLSearchParams(query()).get('private')).toBe('1');
    expect(new URLSearchParams(query()).get('low')).toBe('cleanliness');
    expect(reviewReads.at(-1)?.filters).toEqual({
      ...EMPTY_REVIEW_FILTERS,
      ratingMax: 6,
      withPrivate: true,
      lowCategory: 'cleanliness',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(query()).toBe('tab=all');
    expect(reviewReads.at(-1)?.filters).toEqual(EMPTY_REVIEW_FILTERS);
  });

  test('a link with filters opens the tab as it was left; a range typed backwards is read forwards', () => {
    window.history.replaceState(
      null,
      '',
      '/guests?tab=all&rmin=8&rmax=2&from=2026-10&to=2026-01&channel=airbnb,nope',
    );
    render(<GuestSignalsView isAdmin={false} />);

    expect(screen.getByRole('tab', { name: 'Все отзывы' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(reviewReads.at(-1)?.filters).toEqual({
      ...EMPTY_REVIEW_FILTERS,
      channels: ['airbnb'],
      ratingMin: 2,
      ratingMax: 8,
      monthFrom: '2026-01',
      monthTo: '2026-10',
    });
  });

  test('every listing ticked narrows nothing: a review of an unknown listing stays in the list', () => {
    window.history.replaceState(
      null,
      '',
      '/guests?tab=all&place=7,9,21,22,23,24,25,26,27&channel=airbnb',
    );
    render(<GuestSignalsView isAdmin={false} />);

    expect(reviewReads.at(-1)?.filters).toEqual({
      ...EMPTY_REVIEW_FILTERS,
      channels: ['airbnb'],
    });
  });

  test('nothing through the filters says so, and offers to clear them', async () => {
    window.history.replaceState(null, '', '/guests?tab=all&hidden=1');
    render(<GuestSignalsView isAdmin={false} />);

    expect(screen.getByText('По этим фильтрам отзывов нет.')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Сбросить фильтры' }).at(-1)!);
    expect(query()).toBe('tab=all');
  });

  test('with no filters and no reviews, the old words: nothing is loaded yet', () => {
    window.history.replaceState(null, '', '/guests?tab=all');
    render(<GuestSignalsView isAdmin={false} />);

    expect(screen.getByText('Отзывы ещё не загружены.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сбросить фильтры' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('the text of a review read from Hostaway on the fly', () => {
  test('is asked only on the manager’s word, and shown as Hostaway has it, with what it is', async () => {
    reviews.rows = [review({ has_private_text: true })];
    reviews.total = 1;
    liveText.data = {
      public_text: 'The shower had no hot water.',
      private_text: 'The door code worked once.',
      category_comments: { checkin: 'Keys were late.' },
    };
    window.history.replaceState(null, '', '/guests?tab=all');
    render(<GuestSignalsView isAdmin={false} />);

    expect(textReads.every((read) => !read.enabled)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Показать текст из Hostaway' }));

    expect(textReads.at(-1)).toEqual({ signalId: REVIEW_ID, enabled: true });
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Прочитано из Hostaway сейчас; в woom не хранится.');
    expect(row).toHaveTextContent('The shower had no hot water.');
    expect(row).toHaveTextContent('Приватно, только хозяину: The door code worked once.');
    expect(row).toHaveTextContent('заселение: Keys were late.');
  });

  test('a review the guest wrote no words for offers nothing to read; a kept text is shown as before', () => {
    reviews.rows = [
      review({ has_public_text: false, has_private_text: false }),
      review({
        id: '55555555-5555-4555-8555-555555555555',
        stay_exact: true,
        public_text: 'Kept text. [GUEST] was told.',
      }),
    ];
    reviews.total = 2;
    window.history.replaceState(null, '', '/guests?tab=all');
    render(<GuestSignalsView isAdmin={false} />);

    expect(
      screen.queryByRole('button', { name: 'Показать текст из Hostaway' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Kept text. [GUEST] was told.')).toBeInTheDocument();
  });

  test('a refusal of the function is told in the panel’s words', async () => {
    reviews.rows = [review()];
    reviews.total = 1;
    liveText.error = new ServerRefusal(
      'Too many review texts read in ten minutes',
      'serverErrors.reviewTextLimit',
      JSON.stringify({ limit: 120, minutes: 10 }),
    );
    window.history.replaceState(null, '', '/guests?tab=all');
    render(<GuestSignalsView isAdmin={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Показать текст из Hostaway' }));

    expect(
      screen.getByText(
        'За 10 минут прочитано больше 120 текстов отзывов. Подождите немного и попробуйте снова.',
      ),
    ).toBeInTheDocument();
    // The manager may read again in place, on their own word.
    await userEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }));
    expect(refetchText).toHaveBeenCalledTimes(1);
  });
});

describe('textsFromDay', () => {
  test('the Prague day of the texts’ first day while there is no notice; none before texts went on', () => {
    expect(textsFromDay({ notice_published_at: null, texts_enabled_at: null })).toBeNull();
    expect(
      textsFromDay({ notice_published_at: null, texts_enabled_at: '2026-11-02T09:30:00Z' }),
    ).toBe('2026-11-02');
    // 23:30 UTC is already the next day in Prague, as the database reads it.
    expect(
      textsFromDay({ notice_published_at: null, texts_enabled_at: '2026-11-01T23:30:00Z' }),
    ).toBe('2026-11-02');
  });

  test('a notice with a date draws the line instead', () => {
    expect(
      textsFromDay({
        notice_published_at: '2026-11-20T08:00:00Z',
        texts_enabled_at: '2026-11-02T09:30:00Z',
      }),
    ).toBe('2026-11-20');
  });
});

/** One row of signal_run_status() for reviews. */
function stage(
  name: 'sync' | 'classify',
  lastRunAt: string | null,
  lastOkAt: string | null = lastRunAt,
): RunStatus[number] {
  return { kind: 'review', stage: name, last_run_at: lastRunAt, last_ok_at: lastOkAt };
}

const BOTH = { sync: true, classify: true };

describe('freshness', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');

  test('two clean runs: updated at the newest, nothing to warn of', () => {
    const run = freshness(
      [stage('sync', '2026-10-17T06:00:00Z'), stage('classify', '2026-10-17T06:20:00Z')],
      BOTH,
      now,
    );
    expect(run).toEqual({ updatedAt: '2026-10-17T06:20:00Z', problems: [] });
  });

  test('a clean load does not hide a reading that failed, nor the other way round', () => {
    const morning = Date.parse('2026-10-17T07:00:00Z');
    expect(
      freshness(
        [
          stage('sync', '2026-10-17T06:00:00Z'),
          stage('classify', '2026-10-17T06:20:00Z', '2026-10-16T06:20:00Z'),
        ],
        BOTH,
        morning,
      ),
    ).toEqual({
      updatedAt: '2026-10-17T06:00:00Z',
      problems: [{ kind: 'classifyFailed', at: '2026-10-17T06:20:00Z' }],
    });
    expect(
      freshness(
        [
          stage('sync', '2026-10-17T06:00:00Z', '2026-10-16T06:00:00Z'),
          stage('classify', '2026-10-17T06:20:00Z'),
        ],
        BOTH,
        morning,
      ).problems,
    ).toEqual([{ kind: 'syncFailed', at: '2026-10-17T06:00:00Z' }]);
  });

  test('a job that ran and was never clean has failed', () => {
    expect(freshness([stage('sync', '2026-10-17T06:00:00Z', null)], BOTH, now).problems).toEqual([
      { kind: 'syncFailed', at: '2026-10-17T06:00:00Z' },
    ]);
  });

  test('a reading that did not come after a clean load is missing, past the two hours’ grace only', () => {
    const rows = [stage('sync', '2026-10-17T06:00:00Z'), stage('classify', '2026-10-16T06:20:00Z')];
    expect(freshness(rows, BOTH, Date.parse('2026-10-17T06:10:00Z')).problems).toEqual([]);
    expect(freshness(rows, BOTH, Date.parse('2026-10-17T08:10:00Z')).problems).toEqual([
      { kind: 'classifyMissing', at: '2026-10-17T06:00:00Z' },
    ]);
    // A reading that never ran is the first night's to come, not a missed one.
    expect(freshness([rows[0], stage('classify', null)], BOTH, now).problems).toEqual([]);
  });

  test('a job without a clean run for over a day is stale, each named with its own last one', () => {
    expect(
      freshness(
        [stage('sync', '2026-10-16T06:00:00Z'), stage('classify', '2026-10-16T06:20:00Z')],
        BOTH,
        Date.parse('2026-10-17T07:30:00Z'),
      ).problems,
    ).toEqual([]);
    expect(
      freshness(
        [stage('sync', '2026-10-14T06:00:00Z'), stage('classify', '2026-10-17T06:20:00Z')],
        BOTH,
        now,
      ),
    ).toEqual({
      updatedAt: '2026-10-17T06:20:00Z',
      problems: [{ kind: 'syncStale', at: '2026-10-14T06:00:00Z' }],
    });
    // Failing since the day before: the failed run, and the last clean one.
    expect(
      freshness(
        [
          stage('sync', '2026-10-17T06:00:00Z'),
          stage('classify', '2026-10-17T06:20:00Z', '2026-10-16T06:20:00Z'),
        ],
        BOTH,
        now,
      ).problems,
    ).toEqual([
      { kind: 'classifyFailed', at: '2026-10-17T06:20:00Z' },
      { kind: 'classifyStale', at: '2026-10-16T06:20:00Z' },
    ]);
  });

  test('a job the switches have off is not judged', () => {
    const rows = [
      stage('sync', '2026-10-17T06:00:00Z', '2026-10-10T06:00:00Z'),
      stage('classify', '2026-10-17T06:20:00Z', null),
    ];
    expect(freshness(rows, { sync: false, classify: false }, now).problems).toEqual([]);
    expect(
      freshness(rows, { sync: true, classify: false }, now).problems.map((p) => p.kind),
    ).toEqual(['syncFailed', 'syncStale']);
  });

  test('nothing ran yet: no time and no warning', () => {
    expect(freshness([stage('sync', null), stage('classify', null)], BOTH, now)).toEqual({
      updatedAt: null,
      problems: [],
    });
    expect(freshness([], BOTH, now)).toEqual({ updatedAt: null, problems: [] });
  });
});

describe('expectedStages', () => {
  const off = {
    sync_enabled: false,
    texts_enabled: false,
    notice_published_at: null,
    texts_enabled_at: null,
  };

  test('the load while it is on; the reading only while texts are kept, with their day', () => {
    expect(expectedStages(off)).toEqual({ sync: false, classify: false });
    expect(expectedStages({ ...off, sync_enabled: true })).toEqual({ sync: true, classify: false });
    expect(expectedStages({ ...off, texts_enabled: true })).toEqual({
      sync: false,
      classify: false,
    });
    expect(
      expectedStages({ ...off, texts_enabled: true, texts_enabled_at: '2026-11-02T09:30:00Z' }),
    ).toEqual({ sync: false, classify: true });
    expect(
      expectedStages({ ...off, texts_enabled: false, texts_enabled_at: '2026-11-02T09:30:00Z' }),
    ).toEqual({ sync: false, classify: false });
  });
});

describe('findingAge', () => {
  const now = new Date('2026-10-17T12:00:00Z');

  test('a candidate whose stay is still exact: whole calendar days, never below zero', () => {
    expect(findingAge(finding(), now)).toBe(3);
    expect(findingAge(finding({ created_at: '2026-10-17T10:00:00Z' }), now)).toBe(0);
    expect(findingAge(finding({ created_at: '2026-10-19T10:00:00Z' }), now)).toBe(0);
  });

  test('no age once decided, once its stay is cut to the month, or without its review', () => {
    expect(findingAge(finding({ status: 'rejected' }), now)).toBeNull();
    expect(
      findingAge(finding({ signal: { ...finding().signal, stay_exact: false } }), now),
    ).toBeNull();
    expect(findingAge(finding({ signal: null }), now)).toBeNull();
  });
});

describe('the status line of «Гости»', () => {
  const HOUR = 60 * 60 * 1000;
  const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

  test('a clean load and a failed reading: the time, and a red line for the reading', () => {
    state.settings = {
      ...state.settings,
      texts_enabled: true,
      texts_enabled_at: '2026-11-02T09:30:00Z',
    };
    const loadedAt = ago(3);
    const readAt = ago(2.5);
    runs.rows = [stage('sync', loadedAt), stage('classify', readAt, ago(24.5))];
    render(<GuestSignalsView isAdmin={false} />);

    expect(screen.getByText(`Обновлено ${formatDateTime(loadedAt, 'ru')}`)).toBeInTheDocument();
    expect(
      screen.getByText(`Чтение отзывов прошло с ошибками (${formatDateTime(readAt, 'ru')})`),
    ).toHaveClass('text-destructive');
  });

  test('with texts off the reading is not judged, and the load alone speaks', () => {
    const loadedAt = ago(30);
    runs.rows = [stage('sync', loadedAt), stage('classify', ago(29), null)];
    render(<GuestSignalsView isAdmin={false} />);

    expect(screen.queryByText(/Чтение отзывов/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        `Больше суток без удачной загрузки отзывов (последняя — ${formatDateTime(loadedAt, 'ru')})`,
      ),
    ).toBeInTheDocument();
  });

  test('a status that cannot be read says so instead of saying nothing', () => {
    runs.error = new Error('permission denied for function signal_run_status');
    render(<GuestSignalsView isAdmin={false} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Не удалось узнать, когда отзывы обновлялись в последний раз',
    );
  });
});

describe('chats behind their switch (docs/guest-chats.md)', () => {
  const MESSAGE_ID = '55555555-5555-4555-8555-555555555555';
  const chatCard = () =>
    finding({
      summary: 'hot_water',
      summary_i18n: {},
      evidence: null,
      evidence_source: 'message',
      confidence: 0.9,
      detector: 'claude-haiku-5-5@themes-v1-msg',
      external_conversation_id: '7001',
      signal: {
        id: MESSAGE_ID,
        kind: 'message',
        stay_phase: 'stay',
        channel: 'booking',
        rating: null,
        category_ratings: {},
        arrival_date: '2026-10-13',
        departure_date: '2026-10-16',
        submitted_at: '2026-10-14T09:00:00Z',
        stay_exact: true,
        external_reservation_id: '80000002',
        property_id: 7,
      },
    });

  test('off: no filter and no line of chats', () => {
    render(<GuestSignalsView isAdmin={false} />);
    expect(screen.queryByLabelText('Показывать')).toBeNull();
    expect(screen.queryByText(/Сообщения/)).toBeNull();
  });

  test('on: the filter, and a chat card says where it came from, when, and which conversation, with no text', () => {
    chats.on = true;
    state.findings = [chatCard()];
    render(<GuestSignalsView isAdmin={false} />);
    expect(screen.getByLabelText('Показывать')).toBeTruthy();
    const card = screen.getByRole('article');
    expect(within(card).getByText('Из сообщения гостя')).toBeTruthy();
    expect(within(card).getByText('во время проживания')).toBeTruthy();
    expect(within(card).getByText('Разговор в PMS № 7001')).toBeTruthy();
    expect(within(card).queryByText(/Отзыв целиком/)).toBeNull();
    expect(within(card).queryByText(/без оценки/)).toBeNull();
    expect(within(card).getByText(/Формулировки нет/)).toBeTruthy();
  });

  test('on: the chats’ line says when messages were read, and a failed tick in red', () => {
    chats.on = true;
    chats.rows = [
      {
        kind: 'message',
        stage: 'classify',
        last_run_at: '2026-11-10T10:04:00Z',
        last_ok_at: '2026-11-10T10:02:00Z',
      },
    ];
    render(<GuestSignalsView isAdmin={false} />);
    expect(screen.getByText(/Сообщения прочитаны/)).toBeTruthy();
    expect(screen.getByText(/Чтение сообщений не удалось/)).toBeTruthy();
  });
});

describe('chatFreshness', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const row = (run: string | null, ok: string | null): RunStatus => [
    { kind: 'message', stage: 'classify', last_run_at: run, last_ok_at: ok },
  ];

  test('a clean tick within the hours: the time and nothing to warn of', () => {
    expect(chatFreshness(row('2026-11-10T11:58:00Z', '2026-11-10T11:58:00Z'), now)).toEqual({
      updatedAt: '2026-11-10T11:58:00Z',
      problem: null,
      at: null,
    });
  });

  test('a tick after the last clean one failed', () => {
    expect(chatFreshness(row('2026-11-10T11:58:00Z', '2026-11-10T11:00:00Z'), now).problem).toBe(
      'failed',
    );
  });

  test('no clean tick for two hours and a half is stale; nothing ran yet says nothing', () => {
    expect(chatFreshness(row('2026-11-10T09:00:00Z', '2026-11-10T09:00:00Z'), now).problem).toBe(
      'stale',
    );
    expect(chatFreshness([], now)).toEqual({ updatedAt: null, problem: null, at: null });
  });
});
