import { closingLines, isTaskClosed, type ClosingRow } from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

const t = (key: string, options?: Record<string, string>) => i18n.t(key, options);

const WORKER = '11111111-1111-4111-8111-111111111111';
const people = {
  completed_by: { name: 'Иван', role: 'tech' },
  closed_by: { name: 'Пётр', role: 'manager' },
};

function row(over: Partial<ClosingRow>): ClosingRow {
  return {
    status: 'resolved',
    archived_at: null,
    completed_by: WORKER,
    closed_how: 'worker',
    closed_cause: null,
    closing: people,
    ...over,
  };
}

describe('who did a task and who closed it', () => {
  test('says nothing while the task is open', () => {
    expect(closingLines(row({ status: 'assigned', closed_how: null }), t)).toEqual([]);
    expect(isTaskClosed({ status: 'open', archived_at: null })).toBe(false);
  });

  test('a worker who finished it is the one line', () => {
    expect(
      closingLines(row({ closing: { ...people, closed_by: people.completed_by } }), t),
    ).toEqual(['Выполнил: Иван']);
  });

  test('a manager closing for somebody says both', () => {
    expect(closingLines(row({ closed_how: 'manager_for' }), t)).toEqual([
      'Выполнил: Иван',
      'Закрыл: менеджер Пётр',
    ]);
  });

  test('a manager alone says so, and names no worker', () => {
    expect(
      closingLines(
        row({
          closed_how: 'manager_self',
          completed_by: null,
          closing: { completed_by: null, closed_by: people.closed_by },
        }),
        t,
      ),
    ).toEqual(['Закрыл менеджер сам: Пётр']);
  });

  test('a worker the past does not know is «не указано»', () => {
    expect(
      closingLines(
        row({
          closed_how: 'manager',
          completed_by: null,
          closing: { completed_by: null, closed_by: people.closed_by },
        }),
        t,
      ),
    ).toEqual(['Выполнил: не указано', 'Закрыл: менеджер Пётр']);
    expect(closingLines(row({ closed_how: null, completed_by: null, closing: null }), t)).toEqual([
      'Выполнил: не указано',
      'Закрыл: не указано',
    ]);
  });

  test('the system closing says so; a cause it does not know adds nothing', () => {
    expect(
      closingLines(
        row({ closed_how: 'auto', completed_by: null, closed_cause: 'night_pass', closing: null }),
        t,
      ),
    ).toEqual(['Выполнил: не указано', 'Закрыто автоматически']);
  });

  test('a cancelled task has no worker line, only who closed it', () => {
    expect(
      closingLines(row({ status: 'cancelled', closed_how: 'manager', completed_by: null }), t),
    ).toEqual(['Закрыл: менеджер Пётр']);
  });

  test('an administrator and a name nobody can read are said in words', () => {
    expect(
      closingLines(
        row({
          status: 'cancelled',
          closed_how: 'manager',
          closing: { completed_by: null, closed_by: { name: null, role: 'admin' } },
        }),
        t,
      ),
    ).toEqual(['Закрыл: администратор сотрудник']);
  });

  test('an open task put in the archive is closed by whoever put it there', () => {
    expect(
      closingLines(
        row({
          status: 'open',
          archived_at: '2026-11-09T10:00:00Z',
          closed_how: 'manager',
          completed_by: null,
        }),
        t,
      ),
    ).toEqual(['Закрыл: менеджер Пётр']);
  });
});
