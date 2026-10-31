import { i18n } from '@/i18n';
import { readCached } from '@/lib/read-cached';

import { boardProblemListSchema, boardProblemSchema } from '@/features/board/schema';

import {
  GUEST_SIGNAL_COLUMN_LIST,
  GUEST_SIGNAL_SOURCE_COLUMNS,
  GUEST_SIGNAL_SOURCE_ENABLED,
  shownTitle,
  signalBadges,
  signalLabel,
} from '../signal-source';
import { problemListSchema, problemSchema } from '../schema';

/**
 * Tasks from what a guest sent — a review or a message — on the phone, behind
 * their switch (docs/guest-signals.md §7.1): off, the phone asks for no new
 * column; the cards read such a task the moment the server sends one, say
 * where it came from and the month, and carry «Создано автоматически», with
 * «Подтвердил менеджер» beside it when a manager confirmed it (the owner's
 * decision 7 of 2026-10-31).
 */

/** A task as a build before the guest signals saved it on the phone: none of the new keys. */
const saved = {
  id: 'c8000001-0000-4000-8000-000000000001',
  property_id: 412432,
  task_id: null,
  reported_by: null,
  title: 'Нет горячей воды',
  description: null,
  priority: 'normal',
  status: 'open',
  resolved_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-11-10T08:05:00+00:00',
  property: null,
};

const facts = {
  kind: 'repair',
  subject: 'hot_water',
  channel: 'airbnb',
  period_month: '2026-10',
  mode: 'manager',
} as const;

const fromReview = problemSchema.parse({
  ...saved,
  source: 'review',
  title_i18n: {
    en: 'No hot water in the shower',
    cs: 'Ve sprše neteče teplá voda',
    ru: 'Нет горячей воды в душе',
  },
  source_facts: facts,
});

const fromMessage = problemSchema.parse({
  ...saved,
  source: 'message',
  title_i18n: null,
  source_facts: { ...facts, channel: null, mode: 'auto' },
});

describe('the switch', () => {
  test('is off until the migration is in the cloud (rollout 5c): no new column is asked for', () => {
    expect(GUEST_SIGNAL_SOURCE_ENABLED).toBe(false);
    expect(GUEST_SIGNAL_SOURCE_COLUMNS).toBe('');
  });

  test('on, the selects ask for the three columns, and only for them', () => {
    expect(GUEST_SIGNAL_COLUMN_LIST).toBe('source, title_i18n, source_facts, ');
    expect(GUEST_SIGNAL_SOURCE_COLUMNS).toBe(
      GUEST_SIGNAL_SOURCE_ENABLED ? GUEST_SIGNAL_COLUMN_LIST : '',
    );
  });
});

describe('a copy the phone saved', () => {
  test('by an older build, without the new keys, reads as somebody reported it', () => {
    const [problem] = readCached(problemListSchema, [saved], 'problems');
    const [onBoard] = readCached(
      boardProblemListSchema,
      [{ ...saved, archived_at: null }],
      'board',
    );

    for (const read of [problem, onBoard]) {
      expect(read.source).toBeUndefined();
      expect(read.title_i18n).toBeUndefined();
      expect(read.source_facts).toBeUndefined();
      expect(signalLabel(read, i18n.t)).toBeNull();
      expect(signalBadges(read, i18n.t)).toEqual([]);
    }
  });

  test('by the reviews-only build, facts without `mode`, reads with no manager behind it', () => {
    const older = {
      kind: 'repair',
      subject: 'hot_water',
      channel: 'airbnb',
      period_month: '2026-10',
    };
    const problem = problemSchema.parse({ ...saved, source: 'review', source_facts: older });

    expect(problem.source_facts).toEqual({ ...older, mode: null });
    expect(signalBadges(problem, i18n.t)).toEqual(['Создано автоматически']);
  });
});

describe('what a newer server may send', () => {
  test('a source this build does not know is an ordinary task: no label, no plaque', () => {
    for (const schema of [problemSchema, boardProblemSchema]) {
      const problem = schema.parse({ ...saved, archived_at: null, source: 'from-a-newer-server' });
      expect(problem.source).toBe('staff');
      expect(signalLabel(problem, i18n.t)).toBeNull();
      expect(signalBadges(problem, i18n.t)).toEqual([]);
    }
  });

  test('an odd fact costs only itself: the month and who confirmed it stay', () => {
    const problem = problemSchema.parse({
      ...saved,
      source: 'review',
      source_facts: { period_month: '2026-10', mode: 'manager', kind: 7, channel: ['x'] },
    });

    expect(problem.source_facts).toEqual({
      kind: '',
      subject: '',
      channel: null,
      period_month: '2026-10',
      mode: 'manager',
    });
  });

  test('a mode it does not know is nobody’s confirmation; facts that are no object are none', () => {
    const unknownMode = problemSchema.parse({
      ...saved,
      source: 'message',
      source_facts: { ...facts, mode: 'robot' },
    });
    const noFacts = problemSchema.parse({ ...saved, source: 'review', source_facts: 'facts' });

    expect(unknownMode.source_facts?.mode).toBeNull();
    expect(signalBadges(unknownMode, i18n.t)).toEqual(['Создано автоматически']);
    expect(noFacts.source_facts).toBeNull();
    expect(signalLabel(noFacts, i18n.t)).toBe('Из отзыва гостя');
  });
});

describe('a task from a guest signal', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ru');
  });

  test('shows its title in the reader’s language, and as written in any other', () => {
    expect(shownTitle(fromReview, 'cs')).toBe('Ve sprše neteče teplá voda');
    expect(shownTitle(fromReview, 'de')).toBe('Нет горячей воды');
    expect(shownTitle({ ...fromReview, title_i18n: { cs: '  ' } }, 'cs')).toBe('Нет горячей воды');
    expect(shownTitle(fromMessage, 'en')).toBe('Нет горячей воды');
  });

  test('from a review says so and the month the guest left, never a quote', async () => {
    expect(signalLabel(fromReview, i18n.t)).toBe('Из отзыва гостя · Гость выехал: 2026-10');
    await i18n.changeLanguage('en');
    expect(signalLabel(fromReview, i18n.t)).toBe('From a guest review · Guest left in 2026-10');
    await i18n.changeLanguage('cs');
    expect(signalLabel(fromReview, i18n.t)).toBe('Z recenze hosta · Host odjel v 2026-10');
    await i18n.changeLanguage('ru');
    expect(signalLabel({ ...fromReview, source_facts: null }, i18n.t)).toBe('Из отзыва гостя');
  });

  test('from a message says so and the month it was sent, never its text', async () => {
    expect(signalLabel(fromMessage, i18n.t)).toBe('Из сообщения гостя · Отправлено: 2026-10');
    await i18n.changeLanguage('en');
    expect(signalLabel(fromMessage, i18n.t)).toBe('From a guest message · Sent in 2026-10');
    await i18n.changeLanguage('cs');
    expect(signalLabel(fromMessage, i18n.t)).toBe('Ze zprávy hosta · Odesláno v 2026-10');
    await i18n.changeLanguage('ru');
    const noMonth = { ...fromMessage, source_facts: { ...facts, period_month: null } };
    expect(signalLabel(noMonth, i18n.t)).toBe('Из сообщения гостя');
  });

  test('made on its own carries «Создано автоматически» alone', () => {
    expect(signalBadges(fromMessage, i18n.t)).toEqual(['Создано автоматически']);
    const autoReview = { ...fromReview, source_facts: { ...facts, mode: 'auto' as const } };
    expect(signalBadges(autoReview, i18n.t)).toEqual(['Создано автоматически']);
  });

  test('confirmed by a manager carries both plaques, in either kind', async () => {
    const confirmedMessage = {
      ...fromMessage,
      source_facts: { ...facts, mode: 'manager' as const },
    };

    expect(signalBadges(fromReview, i18n.t)).toEqual([
      'Создано автоматически',
      'Подтвердил менеджер',
    ]);
    expect(signalBadges(confirmedMessage, i18n.t)).toEqual([
      'Создано автоматически',
      'Подтвердил менеджер',
    ]);
    await i18n.changeLanguage('en');
    expect(signalBadges(fromReview, i18n.t)).toEqual([
      'Created automatically',
      'Confirmed by a manager',
    ]);
  });

  test('a task somebody on the staff reported carries no label and no plaque', () => {
    const reported = problemSchema.parse({ ...saved, source: 'staff', source_facts: null });

    expect(signalLabel(reported, i18n.t)).toBeNull();
    expect(signalBadges(reported, i18n.t)).toEqual([]);
  });
});
