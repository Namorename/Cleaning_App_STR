import { staffNames } from '@/features/board/format';
import { i18n } from '@/i18n';
import {
  CLEANER_ANNA,
  HEAD_TECH,
  PROBLEM_ID,
  REPAIR_ID,
  STAFF,
  TECH_IVAN,
  TECH_OLGA,
} from '@/testing/board-fixtures';
import { pinToday } from '@/testing/clock';

import { historyWhat, historyWho } from '../lines';
import { problemEventListSchema, type ProblemEvent } from '../schema';

/**
 * One line of a task's history per kind of event, with the parameters the
 * migrations write (20261003140000_problem_events, 20261004100000_staff_disable):
 * ids, days, hours and statuses, never text — the words are the phone's, in
 * the reader's language. A person is named from the directory; one it does not
 * know, or none at all, is a neutral word.
 */

const NAMES = staffNames(STAFF, i18n.t);

// The dates below were written on 9 October 2026: a day of another year
// names its year, one of this year does not.
beforeAll(() => {
  pinToday(new Date(2026, 9, 9, 12, 0));
});

afterAll(() => {
  jest.useRealTimers();
});

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

    expect(line).toBe('Перенесено · пт, 9 октября → сб, 10 октября · с 09:00');
  });

  test('hours with an end only read «до»', () => {
    expect(
      historyWhat(event('rescheduled', { date: '2026-10-10', time_to: '12:00:00' }), NAMES),
    ).toBe('Перенесено · сб, 10 октября · до 12:00');
  });

  test('a day of another year names its year', () => {
    expect(historyWhat(event('assigned', { to: TECH_IVAN, date: '2025-12-30' }), NAMES)).toBe(
      'Назначено: Иван Петров · вт, 30 декабря 2025 г.',
    );
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

  // A string that is no calendar date would be an invalid Date, and Intl
  // throws a RangeError on it: the screen would fall over on one odd row.
  test.each(['yesterday', '2026-10-09T08:00:00Z', '09.10.2026', ''])(
    'a day written as «%s» is left out, not thrown on',
    (date) => {
      expect(
        historyWhat(
          event('reassigned', { from: TECH_IVAN, to: TECH_OLGA, from_date: date, date }),
          NAMES,
        ),
      ).toBe('Передано: Иван Петров → Ольга Сидорова');
    },
  );

  test('a day moved from an odd one names only the day it went to', () => {
    expect(
      historyWhat(event('rescheduled', { from_date: 'soon', date: '2026-10-10' }), NAMES),
    ).toBe('Перенесено · сб, 10 октября');
  });

  test('hours that are no clock time are left out', () => {
    expect(
      historyWhat(event('rescheduled', { date: '2026-10-10', time_from: 'morning' }), NAMES),
    ).toBe('Перенесено · сб, 10 октября');
  });

  test('who did it: by name; nobody is the system; somebody unknown is «Сотрудник»', () => {
    expect(historyWho(event('accepted'), NAMES)).toBe('Сергей Главный');
    expect(historyWho({ ...event('accepted'), actor_id: null }, NAMES)).toBe('Система');
    expect(
      historyWho({ ...event('accepted'), actor_id: 'f0f0f0f0-0000-4000-8000-000000000000' }, NAMES),
    ).toBe('Сотрудник');
  });
});

/**
 * What the office added to a task (20261126100000): the journal keeps numbers, a stage and ids —
 * never the words, which stay in the task's chat. The kinds are new; every build before reads a
 * kind as any string (schema.ts since its first version) and says «Другое событие» for one it
 * does not know — the line below for a future kind is the very path those builds take.
 */
describe('what the office added', () => {
  const ADDITION = 'f1261200-0000-4000-8000-000000000001';
  const MESSAGE = 'f1261400-0000-4000-8000-000000000001';

  test('files at work: how many photos and videos, and where', () => {
    expect(
      historyWhat(
        event('media_added', { count: 3, photos: 2, videos: 1, at: 'open', addition: ADDITION }),
        NAMES,
      ),
    ).toBe('Добавлены файлы: 2 фото, 1 видео · в открытом задании');
  });

  test('files at the closing, photos only', () => {
    expect(
      historyWhat(
        event('media_added', { count: 1, photos: 1, videos: 0, at: 'closing', addition: ADDITION }),
        NAMES,
      ),
    ).toBe('Добавлены файлы: 1 фото · при закрытии');
  });

  test('a comment, in an open task, at the closing, after it — and no words of it', () => {
    expect(historyWhat(event('comment_added', { at: 'open', message: MESSAGE }), NAMES)).toBe(
      'Добавлен комментарий · в открытом задании',
    );
    expect(historyWhat(event('comment_added', { at: 'closing', message: MESSAGE }), NAMES)).toBe(
      'Добавлен комментарий · при закрытии',
    );
    expect(historyWhat(event('comment_added', { at: 'closed', message: MESSAGE }), NAMES)).toBe(
      'Добавлен комментарий · в закрытом задании',
    );
  });

  test('odd parameters are dropped, never a broken line', () => {
    expect(
      historyWhat(event('media_added', { photos: 'two', videos: -1, at: 'later' }), NAMES),
    ).toBe('Добавлены файлы: —');
    expect(historyWhat(event('comment_added', { at: 42 }), NAMES)).toBe('Добавлен комментарий');
  });

  test('a build that does not know a kind reads its row and says «Другое событие»', () => {
    const rows = problemEventListSchema.parse([
      {
        id: 7,
        problem_id: PROBLEM_ID,
        task_id: null,
        kind: 'media_added',
        actor_id: null,
        created_at: '2026-11-26T10:00:00+00:00',
        params: { count: 1, photos: 1, videos: 0, at: 'open', addition: ADDITION },
      },
    ]);
    expect(rows[0].kind).toBe('media_added');
    expect(historyWhat(event('photos_and_more_added', { count: 3 }), NAMES)).toBe('Другое событие');
  });
});
