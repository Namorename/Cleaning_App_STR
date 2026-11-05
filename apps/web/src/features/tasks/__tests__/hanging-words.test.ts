import { describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

/**
 * How long a job has hung undone, in each language's own form of the number
 * (owner, 2026-11-05): «Висит 1 день / 2 дня / 5 дней», not «дн.».
 */
describe('how long a job has hung, in words', () => {
  test.each([
    ['ru', 1, 'Висит 1 день'],
    ['ru', 2, 'Висит 2 дня'],
    ['ru', 4, 'Висит 4 дня'],
    ['ru', 5, 'Висит 5 дней'],
    ['ru', 11, 'Висит 11 дней'],
    ['ru', 21, 'Висит 21 день'],
    ['ru', 22, 'Висит 22 дня'],
    ['en', 1, 'Pending for 1 day'],
    ['en', 2, 'Pending for 2 days'],
    ['cs', 1, 'Čeká 1 den'],
    ['cs', 3, 'Čeká 3 dny'],
    ['cs', 5, 'Čeká 5 dní'],
  ])('%s reads %i days as «%s»', (language, count, expected) => {
    expect(i18n.getFixedT(language)('panel.tasks.tail.hanging', { count })).toBe(expected);
  });

  test.each([
    ['ru', 'Просрочено', 'Показать отменённые'],
    ['en', 'Overdue', 'Show cancelled'],
    ['cs', 'Po termínu', 'Zobrazit zrušené'],
  ])('%s names the overdue badge and the switch of the cancelled', (language, overdue, show) => {
    const t = i18n.getFixedT(language);

    expect(t('panel.tasks.overdue')).toBe(overdue);
    expect(t('panel.tasks.filters.showCancelled')).toBe(show);
  });

  // The phone's board says it in the same words as the panel (owner, 2026-11-05).
  test.each([
    ['ru', 1],
    ['ru', 3],
    ['ru', 5],
    ['ru', 21],
    ['en', 1],
    ['en', 4],
    ['cs', 1],
    ['cs', 3],
    ['cs', 5],
  ])('%s: the head technician board reads %i days as the panel does', (language, count) => {
    const t = i18n.getFixedT(language);

    expect(t('problems.board.hanging', { count })).toBe(t('panel.tasks.tail.hanging', { count }));
  });
});

/**
 * A cleaning the night sweep closed never happened (owner, 2026-11-05): the
 * list and the analytics column call it what the calendar's mark does, not
 * «Просрочена», which now means a job still hanging three days on.
 */
describe('the cleaning that never happened', () => {
  test.each([
    ['ru', 'Не состоялась'],
    ['en', 'Did not happen'],
    ['cs', 'Neproběhlo'],
  ])('%s calls it «%s» in the list, the analytics and the calendar alike', (language, words) => {
    const t = i18n.getFixedT(language);

    expect(t('panel.tasks.statuses.expired')).toBe(words);
    expect(t('panel.analytics.columns.expired')).toBe(words);
    expect(t('panel.calendar.expiredMark')).toBe(words);
  });
});
