import { staffNames } from '@/features/board/format';
import {
  CLEANER_ANNA,
  HEAD_TECH,
  PROBLEM_ID,
  REPAIR_ID,
  STAFF,
  TECH_IVAN,
  TECH_OLGA,
} from '@/testing/board-fixtures';

import { historyWhat, historyWho } from '../lines';
import type { ProblemEvent } from '../schema';

/**
 * One line of a task's history per kind of event, with the parameters the
 * migrations write (20261003140000_problem_events, 20261004100000_staff_disable):
 * ids, days, hours and statuses, never text — the words are the phone's, in
 * the reader's language. A person is named from the directory; one it does not
 * know, or none at all, is a neutral word.
 */

const NAMES = staffNames(STAFF);

function event(kind: string, params: Record<string, unknown> = {}): ProblemEvent {
  return {
    id: 1,
    problem_id: PROBLEM_ID,
    task_id: REPAIR_ID,
    kind,
    actor_id: HEAD_TECH,
    created_at: '2026-10-09T08:05:00+00:00',
    params,
  };
}

describe('what happened', () => {
  test.each([
    ['reported', { priority: 'high', property: 412432 }, 'Задание заведено'],
    ['accepted', {}, 'Работа принята'],
    ['started', {}, 'Работа начата'],
    ['completed', {}, 'Работа закончена'],
    ['resolved', {}, 'Задание выполнено'],
    ['cancelled', {}, 'Задание отменено'],
    ['reopened', { from: 'resolved' }, 'Задание открыто снова'],
    ['archived', {}, 'Задание в архиве'],
    ['unarchived', {}, 'Задание возвращено из архива'],
  ])('%s', (kind, params, expected) => {
    expect(historyWhat(event(kind, params), NAMES)).toBe(expected);
  });

  test('assigned: to whom, the day and the hours', () => {
    const line = historyWhat(
      event('assigned', {
        to: TECH_IVAN,
        date: '2026-10-09',
        time_from: '10:00:00',
        time_to: '12:00:00',
      }),
      NAMES,
    );

    expect(line).toBe('Назначено: Иван Петров · пт, 9 октября · 10:00–12:00');
  });

  test('assigned without hours says the day alone', () => {
    expect(historyWhat(event('assigned', { to: TECH_IVAN, date: '2026-10-09' }), NAMES)).toBe(
      'Назначено: Иван Петров · пт, 9 октября',
    );
  });

  test('reassigned: from whom to whom, and the day moved with it', () => {
    const line = historyWhat(
      event('reassigned', {
        from: TECH_IVAN,
        to: TECH_OLGA,
        from_date: '2026-10-09',
        date: '2026-10-10',
      }),
      NAMES,
    );

    expect(line).toBe('Передано: Иван Петров → Ольга Сидорова · пт, 9 октября → сб, 10 октября');
  });

  test('reassigned on the same day says the day once', () => {
    const line = historyWhat(
      event('reassigned', { from: CLEANER_ANNA, to: TECH_IVAN, date: '2026-10-09' }),
      NAMES,
    );

    expect(line).toBe('Передано: Анна Белова → Иван Петров · пт, 9 октября');
  });

  test('unassigned: whom the office removed, the repair left waiting', () => {
    expect(historyWhat(event('unassigned', { from: TECH_IVAN }), NAMES)).toBe(
      'Исполнитель убран: Иван Петров',
    );
  });

  test('rescheduled: the day it left and the day it went to, and the hours', () => {
    const line = historyWhat(
      event('rescheduled', {
        from_date: '2026-10-09',
        date: '2026-10-10',
        time_from: '09:00:00',
      }),
      NAMES,
    );

    expect(line).toBe('Перенесено · пт, 9 октября → сб, 10 октября · 09:00–');
  });

  test('attempt_cancelled names the person it held, when it held one', () => {
    expect(historyWhat(event('attempt_cancelled', { assignee: TECH_IVAN }), NAMES)).toBe(
      'Работа отменена: Иван Петров',
    );
    expect(historyWhat(event('attempt_cancelled'), NAMES)).toBe('Работа отменена');
  });

  test('taken_off names the person; the switch of an account says so', () => {
    expect(historyWhat(event('taken_off', { assignee: TECH_IVAN }), NAMES)).toBe(
      'Иван Петров: работа снята',
    );
    expect(
      historyWhat(event('taken_off', { assignee: TECH_IVAN, cause: 'account_disabled' }), NAMES),
    ).toBe('Иван Петров: работа снята — учётка отключена');
  });

  test('a cause this build does not know reads as a plain take-off', () => {
    expect(
      historyWhat(event('taken_off', { assignee: TECH_IVAN, cause: 'moon_phase' }), NAMES),
    ).toBe('Иван Петров: работа снята');
  });

  test('status_changed: from and to, in the words of a job’s statuses', () => {
    expect(historyWhat(event('status_changed', { from: 'assigned', to: 'paused' }), NAMES)).toBe(
      'Статус работы: Назначена → Пауза',
    );
  });

  test('a kind a newer server writes is an event all the same, not an id', () => {
    expect(historyWhat(event('teleported', { to: TECH_IVAN }), NAMES)).toBe('Другое событие');
  });
});

describe('the people in it', () => {
  test('somebody the directory does not know is «Сотрудник»', () => {
    expect(
      historyWhat(event('assigned', { to: 'f0f0f0f0-0000-4000-8000-000000000000' }), NAMES),
    ).toBe('Назначено: Сотрудник');
  });

  test('parameters of the wrong shape do not break the line', () => {
    expect(historyWhat(event('assigned', { to: 42, date: ['x'] }), NAMES)).toBe(
      'Назначено: Сотрудник',
    );
  });

  test('who did it: by name, or the neutral word for the system or a deleted person', () => {
    expect(historyWho(event('accepted'), NAMES)).toBe('Сергей Главный');
    expect(historyWho({ ...event('accepted'), actor_id: null }, NAMES)).toBe('Сотрудник');
  });
});
