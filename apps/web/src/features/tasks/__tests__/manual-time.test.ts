import { describe, expect, test } from 'vitest';

import {
  clearCleaningTime,
  fetchTask,
  fetchTasks,
  fetchTasksBetween,
  handHoursOf,
  setCleaningTime,
} from '../api';
import {
  calendarTaskSchema,
  canSetCleaningTime,
  draftFromTask,
  hasManualTimeGap,
  isDraftReady,
  taskSchema,
  type TaskDraft,
} from '../schema';

/**
 * Hours a manager sets by hand on a booking's cleaning (20261027120000): the
 * row carries the day they were set for and the mark of hand-set hours a
 * change of day undid, every reader asks for both, and the two RPCs send the
 * day the form showed.
 */

interface Call {
  name: string;
  args: unknown[];
}

function recordingClient(single: unknown = null) {
  const calls: Call[] = [];

  const builder = () => {
    const answer = Promise.resolve({ data: [], error: null, count: 0 });
    const self: Record<string, unknown> = {
      then: answer.then.bind(answer),
      catch: answer.catch.bind(answer),
      finally: answer.finally.bind(answer),
    };
    for (const name of ['select', 'eq', 'neq', 'gte', 'lt', 'in', 'not', 'order', 'range']) {
      self[name] = (...args: unknown[]) => {
        calls.push({ name, args });
        return self;
      };
    }
    self.maybeSingle = () => Promise.resolve({ data: single, error: null });
    return self;
  };

  return {
    client: {
      from: () => builder(),
      rpc: (name: string, args: unknown) => {
        calls.push({ name: 'rpc', args: [name, args] });
        return Promise.resolve({ data: single, error: null });
      },
    } as never,
    calls,
  };
}

const selectOf = (calls: readonly Call[]) =>
  String(calls.find((call) => call.name === 'select')?.args[0] ?? '');

const rpcOf = (calls: readonly Call[]) => calls.find((call) => call.name === 'rpc')?.args;

const TASK_ID = '44444444-4444-4444-8444-444444444445';

const row = {
  id: TASK_ID,
  property_id: 1,
  reservation_id: 58123,
  problem_id: null,
  type: 'cleaning',
  status: 'assigned',
  priority: 0,
  assignee_id: null,
  created_by: null,
  scheduled_date: '2026-09-29',
  time_from: '12:00:00',
  time_to: '14:30:00',
  started_at: null,
  completed_at: null,
  measured_minutes: null,
  duration_override_min: null,
  is_parallel: false,
  is_short_measurement: null,
  notes: null,
  title: null,
  title_i18n: null,
  created_at: '2026-09-20T08:00:00+00:00',
};

const draft = (overrides: Partial<TaskDraft>): TaskDraft => ({
  id: TASK_ID,
  propertyId: 1,
  type: 'cleaning',
  scheduledDate: '2026-09-29',
  title: '',
  assigneeId: null,
  timeFrom: '12:00',
  timeTo: '14:30',
  notes: '',
  expectedDate: '2026-09-29',
  ...overrides,
});

describe('every reader of tasks asks for the hours set by hand', () => {
  test.each([
    ['the list', (client: never) => fetchTasks(client)],
    [
      'the calendar',
      (client: never) => fetchTasksBetween(client, '2026-09-01', '2026-10-01', 'active'),
    ],
    ['one task', (client: never) => fetchTask(client, TASK_ID)],
  ])('%s', async (_name, read) => {
    const { client, calls } = recordingClient();

    await read(client);

    expect(selectOf(calls)).toContain('manual_time_on');
    expect(selectOf(calls)).toContain('manual_time_lost_on');
  });
});

describe('the marks as the panel reads them', () => {
  test('are the day the hours were set for, and the day of hours a change of day undid', () => {
    const task = taskSchema.parse({ ...row, manual_time_on: '2026-09-29' });
    const lost = taskSchema.parse({ ...row, manual_time_lost_on: '2026-09-28' });

    expect(task.manual_time_on).toBe('2026-09-29');
    expect(lost.manual_time_lost_on).toBe('2026-09-28');
  });

  test('are null on a row read without them', () => {
    const task = calendarTaskSchema.parse(row);

    expect(task.manual_time_on).toBeNull();
    expect(task.manual_time_lost_on).toBeNull();
  });
});

describe('who may have hours set by hand', () => {
  test('a booking’s cleaning nobody has started', () => {
    for (const status of ['unassigned', 'assigned', 'accepted']) {
      expect(canSetCleaningTime(taskSchema.parse({ ...row, status }))).toBe(true);
    }
  });

  test('not work under way, not a closed one, not a cleaning written by hand, not a new task', () => {
    for (const status of ['in_progress', 'paused', 'done', 'cancelled', 'expired']) {
      expect(canSetCleaningTime(taskSchema.parse({ ...row, status }))).toBe(false);
    }
    expect(canSetCleaningTime(taskSchema.parse({ ...row, reservation_id: null }))).toBe(false);
    expect(canSetCleaningTime(taskSchema.parse({ ...row, type: 'inspection' }))).toBe(false);
    expect(canSetCleaningTime(null)).toBe(false);
  });
});

describe('the draft of a booking’s cleaning', () => {
  test('holds the hours set by hand while nobody has started it', () => {
    const task = taskSchema.parse({ ...row, manual_time_on: '2026-09-29' });

    expect(draftFromTask(task).manualTime).toBe(true);
  });

  test('of work under way saves nothing about them', () => {
    const task = taskSchema.parse({ ...row, status: 'in_progress', manual_time_on: '2026-09-29' });

    expect(draftFromTask(task).manualTime).toBe(false);
  });

  test('without them holds none', () => {
    expect(draftFromTask(taskSchema.parse(row)).manualTime).toBe(false);
  });
});

describe('hours set by hand need both ends, the start before the end', () => {
  test.each([
    ['both, in order', '12:00', '14:30', false],
    ['the start missing', null, '14:30', true],
    ['the end missing', '12:00', null, true],
    ['the start after the end', '15:00', '14:30', true],
    ['the same hour', '12:00', '12:00', true],
  ])('%s', (_name, timeFrom, timeTo, gap) => {
    expect(hasManualTimeGap(draft({ manualTime: true, timeFrom, timeTo }))).toBe(gap);
  });

  test('the booking’s own hours are not asked about', () => {
    expect(hasManualTimeGap(draft({ manualTime: false, timeFrom: null, timeTo: null }))).toBe(
      false,
    );
  });

  test('a gap keeps the form from saving', () => {
    expect(isDraftReady(draft({ manualTime: true, timeTo: null }))).toBe(false);
    expect(isDraftReady(draft({ manualTime: true }))).toBe(true);
  });
});

describe('the hours a save sets after the task', () => {
  test('are for the day the save leaves the cleaning on', () => {
    expect(handHoursOf(draft({ manualTime: true, scheduledDate: '2026-09-30' }))).toEqual({
      taskId: TASK_ID,
      timeFrom: '12:00',
      timeTo: '14:30',
      expectedDate: '2026-09-30',
    });
  });

  test('are none without the hand', () => {
    expect(handHoursOf(draft({}))).toBeNull();
    expect(handHoursOf(draft({ manualTime: false }))).toBeNull();
  });
});

describe('the two calls', () => {
  test('set_cleaning_time sends the hours and the day', async () => {
    const { client, calls } = recordingClient(row);

    await setCleaningTime(client, {
      taskId: TASK_ID,
      timeFrom: '12:00',
      timeTo: '14:30',
      expectedDate: '2026-09-29',
    });

    expect(rpcOf(calls)).toEqual([
      'set_cleaning_time',
      {
        p_task_id: TASK_ID,
        p_time_from: '12:00',
        p_time_to: '14:30',
        p_expected_date: '2026-09-29',
      },
    ]);
  });

  test('clear_cleaning_time sends the day the form showed', async () => {
    const { client, calls } = recordingClient(row);

    await clearCleaningTime(client, { taskId: TASK_ID, expectedDate: '2026-09-29' });

    expect(rpcOf(calls)).toEqual([
      'clear_cleaning_time',
      { p_task_id: TASK_ID, p_expected_date: '2026-09-29' },
    ]);
  });
});
