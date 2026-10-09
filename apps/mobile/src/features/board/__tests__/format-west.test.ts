/**
 * @jest-environment ./src/testing/west-of-greenwich-env.js
 */
import { historySince } from '@/features/history/lines';
import { i18n } from '@/i18n';
import { pinToday } from '@/testing/clock';

import { formatDay, formatLongDate } from '../format';

/**
 * A calendar date is a day, not an instant: read as midnight UTC it is the
 * day before to anyone west of Greenwich. This file runs in Los Angeles (its
 * environment, above) and in each language the phone speaks, on 9 October
 * 2026 — a day of another year names its year.
 */

beforeAll(() => {
  pinToday(new Date(2026, 9, 9, 12, 0));
});

afterAll(async () => {
  jest.useRealTimers();
  await i18n.changeLanguage('ru');
});

test('runs west of Greenwich', () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
  expect(new Date(2026, 9, 9).getTimezoneOffset()).toBeGreaterThan(0);
});

test.each([
  [
    'ru',
    'пт, 9 октября',
    '3 октября 2026 г.',
    'История начинается с 3 октября 2026 г.',
    'вт, 30 декабря 2025 г.',
  ],
  [
    'en',
    'Fri 9 October',
    '3 October 2026',
    'The history starts on 3 October 2026',
    'Tue, 30 December 2025',
  ],
  ['cs', 'pá 9. října', '3. října 2026', 'Historie začíná 3. října 2026', 'út 30. prosince 2025'],
])(
  '%s: the day, the long date and the «since» line keep their day',
  async (lng, day, long, since, lastYear) => {
    await i18n.changeLanguage(lng);

    expect(formatDay('2026-10-09')).toBe(day);
    expect(formatLongDate('2026-10-03')).toBe(long);
    expect(historySince()).toBe(since);
    expect(formatDay('2025-12-30')).toBe(lastYear);
  },
);
