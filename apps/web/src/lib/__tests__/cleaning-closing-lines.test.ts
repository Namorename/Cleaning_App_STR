import { cleaningClosingLines, isWorkerNameable, type CleaningClosing } from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

const t = (key: string, options?: Record<string, string>) => i18n.t(key, options);

const ANNA = { id: '11111111-1111-4111-8111-111111111111', name: 'Анна', role: 'cleaner' };
const PETR = { id: '22222222-2222-4222-8222-222222222222', name: 'Пётр', role: 'manager' };

function closing(over: Partial<CleaningClosing>): CleaningClosing {
  return {
    completed_by: null,
    worker_source: null,
    closed_by: null,
    closed_how: null,
    closed_cause: null,
    closer_source: 'recorded',
    closed_at: '2026-11-09T10:00:00Z',
    ...over,
  };
}

const text = (status: string, c: CleaningClosing | null) =>
  cleaningClosingLines(status, c, t).map((line) =>
    line.note === null ? line.text : `${line.text} (${line.note})`,
  );

describe('who did a cleaning and who closed it', () => {
  test('says nothing while it is live', () => {
    expect(text('assigned', null)).toEqual([]);
  });

  test('her own finish is one line, with how it is known', () => {
    expect(
      text(
        'done',
        closing({
          completed_by: ANNA,
          worker_source: 'recorded',
          closed_by: ANNA,
          closed_how: 'worker',
        }),
      ),
    ).toEqual(['Выполнила: Анна (отмечено в приложении)']);
  });

  test('a manager closing for her says both', () => {
    expect(
      text(
        'done',
        closing({
          completed_by: ANNA,
          worker_source: 'manager',
          closed_by: PETR,
          closed_how: 'manager_for',
        }),
      ),
    ).toEqual(['Выполнила: Анна (указано менеджером)', 'Закрыл: менеджер Пётр']);
  });

  test('alone, no worker line; not stated, «не указано»', () => {
    expect(text('done', closing({ closed_by: PETR, closed_how: 'manager_self' }))).toEqual([
      'Закрыл менеджер сам: Пётр',
    ]);
    expect(text('done', null)).toEqual(['Выполнила: не указано', 'Закрыл: не указано']);
  });

  test('a cancel says who, or the cause the system had', () => {
    expect(text('cancelled', closing({ closed_by: PETR, closed_how: 'manager' }))).toEqual([
      'Отменил: менеджер Пётр',
    ]);
    expect(
      text('cancelled', closing({ closed_how: 'auto', closed_cause: 'booking_cancelled' })),
    ).toEqual(['Отменена автоматически: бронь отменена']);
    expect(text('cancelled', null)).toEqual(['Отменена: не указано']);
  });

  test('a lapse is the night pass, said in full', () => {
    expect(text('expired', closing({ closed_how: 'auto', closed_cause: 'night_pass' }))).toEqual([
      'Не состоялась: закрыта автоматически (ночной проход)',
    ]);
    expect(
      text(
        'expired',
        closing({ closed_how: 'auto', closed_cause: 'night_pass', closer_source: 'derived' }),
      ),
    ).toEqual(['Не состоялась: закрыта автоматически (ночной проход) (выведено из данных)']);
  });

  test('only a finished one that says «не указано» can have its worker named', () => {
    expect(isWorkerNameable('done', closing({ closed_by: PETR, closed_how: 'manager' }))).toBe(
      true,
    );
    expect(isWorkerNameable('done', closing({ closed_by: PETR, closed_how: 'manager_self' }))).toBe(
      false,
    );
    expect(
      isWorkerNameable('done', closing({ completed_by: ANNA, worker_source: 'recorded' })),
    ).toBe(false);
    expect(isWorkerNameable('cancelled', null)).toBe(false);
  });
});
