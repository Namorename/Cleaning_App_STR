import { describe, expect, test } from 'vitest';

import {
  draftFromTask,
  groupTasks,
  isDraftReady,
  isManualTask,
  isOverdue,
  localizedTitle,
  matchesFilters,
  tabOf,
  taskMinutes,
  taskSchema,
  timeGroup,
  type Task,
} from '../schema';

const TODAY = '2026-09-11';

const base = {
  property_id: 1,
  reservation_id: null,
  problem_id: null,
  type: 'cleaning',
  status: 'assigned',
  priority: 0,
  assignee_id: null,
  created_by: null,
  scheduled_date: TODAY,
  time_from: null,
  time_to: null,
  started_at: null,
  completed_at: null,
  measured_minutes: null,
  duration_override_min: null,
  is_parallel: false,
  is_short_measurement: null,
  notes: null,
  title: null,
  title_i18n: null,
  created_at: '2026-09-10T08:00:00+00:00',
};

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`;

const task = (overrides: Partial<Task> & { id: string }): Task =>
  taskSchema.parse({ ...base, ...overrides });

describe('tabOf', () => {
  test('puts work of today in today', () => {
    expect(tabOf({ status: 'assigned', scheduled_date: TODAY }, TODAY)).toBe('today');
  });

  test('keeps an open task whose day has passed in today, where it can still be seen', () => {
    expect(tabOf({ status: 'unassigned', scheduled_date: '2026-09-09' }, TODAY)).toBe('today');
  });

  test('puts a later day in upcoming', () => {
    expect(tabOf({ status: 'assigned', scheduled_date: '2026-09-12' }, TODAY)).toBe('upcoming');
  });

  test('puts anything closed in closed, whatever its day', () => {
    expect(tabOf({ status: 'done', scheduled_date: '2026-09-12' }, TODAY)).toBe('closed');
    expect(tabOf({ status: 'cancelled', scheduled_date: TODAY }, TODAY)).toBe('closed');
    expect(tabOf({ status: 'expired', scheduled_date: '2026-09-01' }, TODAY)).toBe('closed');
  });
});

describe('isOverdue', () => {
  test('an open task from yesterday is overdue', () => {
    expect(isOverdue({ status: 'assigned', scheduled_date: '2026-09-10' }, TODAY)).toBe(true);
  });

  test('a finished task from yesterday is not', () => {
    expect(isOverdue({ status: 'done', scheduled_date: '2026-09-10' }, TODAY)).toBe(false);
  });

  test('nor is today', () => {
    expect(isOverdue({ status: 'assigned', scheduled_date: TODAY }, TODAY)).toBe(false);
  });
});

describe('timeGroup', () => {
  test('reads the hour of the window', () => {
    expect(timeGroup({ time_from: '08:30:00' })).toBe('morning');
    expect(timeGroup({ time_from: '12:00:00' })).toBe('afternoon');
    expect(timeGroup({ time_from: '16:59:00' })).toBe('afternoon');
    expect(timeGroup({ time_from: '17:00:00' })).toBe('evening');
  });

  test('a task with no window belongs to no part of the day', () => {
    expect(timeGroup({ time_from: null })).toBe('anytime');
  });
});

describe('groupTasks', () => {
  test('groups today by the part of the day, earliest first, and drops empty parts', () => {
    const groups = groupTasks(
      [
        task({ id: id(1), time_from: '18:00:00' }),
        task({ id: id(2), time_from: null }),
        task({ id: id(3), time_from: '09:00:00' }),
        task({ id: id(4), time_from: '08:00:00' }),
      ],
      'today',
    );

    expect(groups.map((group) => group.key)).toEqual(['morning', 'evening', 'anytime']);
    expect(groups[0]?.tasks.map((entry) => entry.time_from)).toEqual(['08:00:00', '09:00:00']);
  });

  test('groups the days ahead by day, nearest first', () => {
    const groups = groupTasks(
      [
        task({ id: id(1), scheduled_date: '2026-09-14' }),
        task({ id: id(2), scheduled_date: '2026-09-12' }),
      ],
      'upcoming',
    );

    expect(groups.map((group) => group.key)).toEqual(['2026-09-12', '2026-09-14']);
    expect(groups.every((group) => group.kind === 'day')).toBe(true);
  });

  test('groups what is behind us most recent first', () => {
    const groups = groupTasks(
      [
        task({ id: id(1), status: 'done', scheduled_date: '2026-09-08' }),
        task({ id: id(2), status: 'done', scheduled_date: '2026-09-10' }),
      ],
      'closed',
    );

    expect(groups.map((group) => group.key)).toEqual(['2026-09-10', '2026-09-08']);
  });

  test('a task with no window closes its day', () => {
    const groups = groupTasks(
      [
        task({ id: id(1), scheduled_date: '2026-09-12', time_from: null }),
        task({ id: id(2), scheduled_date: '2026-09-12', time_from: '10:00:00' }),
      ],
      'upcoming',
    );

    expect(groups[0]?.tasks.map((entry) => entry.id)).toEqual([id(2), id(1)]);
  });
});

describe('matchesFilters', () => {
  const maria = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
  const cleaning = task({
    id: id(1),
    title: 'Генеральная уборка',
    assignee_id: maria,
    property: { name: 'Vinohrady 12' },
    assignee: { full_name: 'Maria Test' },
  });
  const inspection = task({ id: id(2), type: 'inspection', title: 'Осмотр' });

  test('an empty filter keeps everything', () => {
    expect(matchesFilters(cleaning, { query: '', assigneeId: 'all', type: 'all' })).toBe(true);
  });

  test('the query reads the title, the listing and the person', () => {
    const filters = { assigneeId: 'all', type: 'all' as const };
    expect(matchesFilters(cleaning, { ...filters, query: 'генеральная' })).toBe(true);
    expect(matchesFilters(cleaning, { ...filters, query: 'vinohrady' })).toBe(true);
    expect(matchesFilters(cleaning, { ...filters, query: 'maria' })).toBe(true);
    expect(matchesFilters(cleaning, { ...filters, query: 'karlín' })).toBe(false);
  });

  test('nobody keeps only the work still in the queue', () => {
    expect(matchesFilters(cleaning, { query: '', assigneeId: 'nobody', type: 'all' })).toBe(false);
    expect(matchesFilters(inspection, { query: '', assigneeId: 'nobody', type: 'all' })).toBe(true);
  });

  test('a person keeps only their own work', () => {
    expect(matchesFilters(cleaning, { query: '', assigneeId: maria, type: 'all' })).toBe(true);
    expect(matchesFilters(inspection, { query: '', assigneeId: maria, type: 'all' })).toBe(false);
  });

  test('the kind filters by kind', () => {
    expect(matchesFilters(cleaning, { query: '', assigneeId: 'all', type: 'inspection' })).toBe(
      false,
    );
    expect(matchesFilters(inspection, { query: '', assigneeId: 'all', type: 'inspection' })).toBe(
      true,
    );
  });
});

describe('localizedTitle', () => {
  test('reads the translation for the language', () => {
    const entry = { title: 'Генеральная уборка', title_i18n: { cs: 'Hloubkový úklid' } };
    expect(localizedTitle(entry, 'cs')).toBe('Hloubkový úklid');
  });

  test('falls back to the company words when there is no translation', () => {
    const entry = { title: 'Генеральная уборка', title_i18n: { cs: '  ' } };
    expect(localizedTitle(entry, 'cs')).toBe('Генеральная уборка');
    expect(localizedTitle({ title: 'Осмотр', title_i18n: null }, 'en')).toBe('Осмотр');
  });

  test('a generated task has no title of its own', () => {
    expect(localizedTitle({ title: null, title_i18n: null }, 'ru')).toBeNull();
  });
});

describe('taskMinutes', () => {
  test('the correction wins over the measurement', () => {
    expect(taskMinutes({ measured_minutes: 40, duration_override_min: 95 })).toBe(95);
  });

  test('without one, the measurement stands', () => {
    expect(taskMinutes({ measured_minutes: 40, duration_override_min: null })).toBe(40);
    expect(taskMinutes({ measured_minutes: null, duration_override_min: null })).toBeNull();
  });
});

describe('isManualTask', () => {
  test('a task from a booking or a report was not written by hand', () => {
    expect(isManualTask({ reservation_id: 7, problem_id: null })).toBe(false);
    expect(isManualTask({ reservation_id: null, problem_id: id(9) })).toBe(false);
    expect(isManualTask({ reservation_id: null, problem_id: null })).toBe(true);
  });
});

describe('draftFromTask', () => {
  test('carries the task into the form, with the clock cut to hours and minutes', () => {
    const draft = draftFromTask(
      task({
        id: id(1),
        title: 'Генеральная уборка',
        title_i18n: { en: 'Deep clean' },
        time_from: '10:00:00',
        time_to: '12:30:00',
        notes: 'Ключи у соседей',
      }),
    );

    expect(draft).toMatchObject({
      id: id(1),
      title: 'Генеральная уборка',
      timeFrom: '10:00',
      timeTo: '12:30',
      notes: 'Ключи у соседей',
    });
  });
});

describe('isDraftReady', () => {
  const draft = draftFromTask(task({ id: id(1), title: 'Осмотр' }));

  test('a listing and a day are what the panel can check itself', () => {
    expect(isDraftReady(draft)).toBe(true);
    expect(isDraftReady({ ...draft, propertyId: null })).toBe(false);
    // A task without a name is called by its kind, so a blank title is fine.
    expect(isDraftReady({ ...draft, title: '   ' })).toBe(true);
    expect(isDraftReady({ ...draft, scheduledDate: '' })).toBe(false);
  });
});
