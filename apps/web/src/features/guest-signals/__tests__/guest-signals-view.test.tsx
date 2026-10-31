import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { findingSchema, freshness, type Finding } from '../schema';

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
    notice_published_at: null,
  },
};
const approve = vi.fn();
const reject = vi.fn();
const update = vi.fn();
const idle = { isPending: false, isError: false, error: null };
const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null });

vi.mock('../use-guest-signals', () => ({
  useFindings: () => loaded(state.findings),
  useCandidateCount: () => loaded(state.findings.length),
  useReviewList: () => loaded([]),
  usePlaceProblems: () => loaded(state.place),
  useSignalSettings: () => loaded(state.settings),
  useRunStatus: () =>
    loaded([
      {
        kind: 'review',
        stage: 'sync',
        last_run_at: '2026-10-17T06:00:00Z',
        last_ok_at: '2026-10-17T06:00:00Z',
      },
    ]),
  useApproveFinding: () => ({ ...idle, mutate: approve }),
  useRejectFinding: () => ({ ...idle, mutate: reject }),
  useAddFinding: () => ({ ...idle, mutate: vi.fn() }),
  useUpdateSettings: () => ({ ...idle, mutate: update }),
}));
vi.mock('@/features/problems/use-problems', () => ({
  useStaff: () => loaded([{ id: TECH_ID, full_name: 'Petr Fixer', role: 'tech' }]),
}));

import { GuestSignalsView } from '../guest-signals-view';

beforeEach(() => {
  vi.clearAllMocks();
  state.findings = [finding()];
  state.place = [];
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

describe('freshness', () => {
  test('warns when two days went by without a clean run', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(
      freshness(
        [
          {
            kind: 'review',
            stage: 'sync',
            last_run_at: '2026-10-17T06:00:00Z',
            last_ok_at: '2026-10-17T06:00:00Z',
          },
        ],
        now,
      ).isStale,
    ).toBe(false);
    expect(
      freshness(
        [
          {
            kind: 'review',
            stage: 'sync',
            last_run_at: '2026-10-17T06:00:00Z',
            last_ok_at: '2026-10-14T06:00:00Z',
          },
        ],
        now,
      ).isStale,
    ).toBe(true);
    expect(
      freshness([{ kind: 'review', stage: 'sync', last_run_at: null, last_ok_at: null }], now),
    ).toEqual({
      lastOk: null,
      isStale: false,
    });
  });
});
