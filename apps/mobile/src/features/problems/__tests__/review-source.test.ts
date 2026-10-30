import { i18n } from '@/i18n';

import { boardProblemSchema } from '@/features/board/schema';

import {
  REVIEW_SOURCE_COLUMNS,
  REVIEW_SOURCE_ENABLED,
  reviewLabel,
  shownTitle,
} from '../review-source';
import { problemSchema } from '../schema';

/**
 * Tasks from guest reviews on the phone, behind their switch
 * (docs/reviews-to-tasks.md §4.5): off, the phone asks for no new column;
 * the cards read a task from a review the moment the server sends one.
 */

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

const fromReview = problemSchema.parse({
  ...saved,
  source: 'review',
  title_i18n: {
    en: 'No hot water in the shower',
    cs: 'Ve sprše neteče teplá voda',
    ru: 'Нет горячей воды в душе',
  },
  review_facts: {
    kind: 'repair',
    subject: 'hot_water',
    channel: 'airbnb',
    departure_month: '2026-10',
  },
});

describe('the switch', () => {
  test('is on once the migration is in the cloud: the selects ask for the three columns', () => {
    expect(REVIEW_SOURCE_ENABLED).toBe(true);
    expect(REVIEW_SOURCE_COLUMNS).toBe('source, title_i18n, review_facts, ');
  });

  test('a task saved by an older build reads as somebody reported it', () => {
    const problem = problemSchema.parse(saved);
    expect(problem.source).toBeUndefined();
    expect(problem.title_i18n).toBeUndefined();
    expect(reviewLabel(problem, i18n.t)).toBeNull();
    expect(boardProblemSchema.parse({ ...saved, archived_at: null }).source).toBeUndefined();
    expect(problemSchema.parse({ ...saved, source: 'from-a-newer-server' }).source).toBe('staff');
  });
});

describe('a task from a guest review', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ru');
  });

  test('shows its title in the reader’s language, and as written in any other', () => {
    expect(shownTitle(fromReview, 'cs')).toBe('Ve sprše neteče teplá voda');
    expect(shownTitle(fromReview, 'de')).toBe('Нет горячей воды');
  });

  test('says it came from a guest review and the month the guest left, never a quote', async () => {
    await i18n.changeLanguage('en');
    expect(reviewLabel(fromReview, i18n.t)).toBe('From a guest review · Guest left in 2026-10');
    await i18n.changeLanguage('cs');
    expect(reviewLabel(fromReview, i18n.t)).toBe('Z recenze hosta · Host odjel v 2026-10');
    await i18n.changeLanguage('ru');
    expect(reviewLabel({ ...fromReview, review_facts: null }, i18n.t)).toBe('Из отзыва гостя');
  });
});
