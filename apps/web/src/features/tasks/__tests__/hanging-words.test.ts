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
});
