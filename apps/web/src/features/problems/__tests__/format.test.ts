import { describe, expect, test } from 'vitest';

import { formatClock, formatDay, priorityVariant, statusVariant, stepTitle, todayIso } from '../format';

describe('formatDay', () => {
  test('reads a database day as a calendar day in the manager language', () => {
    expect(formatDay('2026-09-10', 'en')).toBe('10 Sept 2026');
    expect(formatDay('2026-09-10', 'ru')).toContain('2026');
  });
});

describe('formatClock', () => {
  test('drops the seconds', () => {
    expect(formatClock('09:30:00')).toBe('09:30');
  });
});

describe('stepTitle', () => {
  test('prefers the manager language and falls back to the company words', () => {
    const step = { title: 'Фото проблемы', title_i18n: { en: 'Photos of the problem' } };
    expect(stepTitle(step, 'en')).toBe('Photos of the problem');
    expect(stepTitle(step, 'cs')).toBe('Фото проблемы');
    expect(stepTitle({ title: null, title_i18n: null }, 'ru')).toBeNull();
  });
});

describe('badge variants', () => {
  test('open problems and high priority read as destructive', () => {
    expect(statusVariant('open')).toBe('destructive');
    expect(statusVariant('resolved')).toBe('secondary');
    expect(priorityVariant('high')).toBe('destructive');
    expect(priorityVariant('low')).toBe('outline');
  });
});

describe('todayIso', () => {
  test('pads month and day', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
