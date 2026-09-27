import { describe, expect, test } from 'vitest';

import { fetchTask, fetchTasks, fetchTasksBetween, saveTask } from '../api';
import { calendarTaskSchema, draftFromTask, taskSchema, type TaskDraft } from '../schema';

/**
 * A booking's cleaning moved by the manager holds while the booking keeps the
 * dates it had at the move (20260926160000_pinned_cleaning.sql): the row
 * carries those dates, and the panel reads them wherever it reads a task.
 * A save sends the day the form was opened with, and the server refuses one
 * made against a day the task no longer stands on.
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

const rpcArgsOf = (calls: readonly Call[]) =>
  calls.find((call) => call.name === 'rpc')?.args[1] as Record<string, unknown>;

const TASK_ID = '44444444-4444-4444-8444-444444444444';

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
  time_from: '11:00:00',
  time_to: '15:00:00',
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

describe('every reader of tasks asks for the pin', () => {
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

    expect(selectOf(calls)).toContain('pinned_arrival');
    expect(selectOf(calls)).toContain('pinned_departure');
  });
});

describe('the pin as the panel reads it', () => {
  test('is the booking’s dates at the move', () => {
    const task = taskSchema.parse({
      ...row,
      scheduled_date: '2026-09-30',
      pinned_arrival: '2026-09-25',
      pinned_departure: '2026-09-29',
    });

    expect(task.pinned_arrival).toBe('2026-09-25');
    expect(task.pinned_departure).toBe('2026-09-29');
  });

  test('is null on a task nobody moved, and on a row read without it', () => {
    const task = calendarTaskSchema.parse(row);

    expect(task.pinned_arrival).toBeNull();
    expect(task.pinned_departure).toBeNull();
  });
});

describe('the day the form was opened with', () => {
  const draft = (overrides: Partial<TaskDraft>): TaskDraft => ({
    id: TASK_ID,
    propertyId: 1,
    type: 'cleaning',
    scheduledDate: '2026-09-30',
    title: '',
    assigneeId: null,
    timeFrom: null,
    timeTo: null,
    notes: '',
    expectedDate: null,
    ...overrides,
  });

  test('is the day the task stood on when its draft was made', () => {
    expect(draftFromTask(taskSchema.parse(row)).expectedDate).toBe('2026-09-29');
  });

  test('an edit sends it, whatever day the draft moves the task to', async () => {
    const { client, calls } = recordingClient(row);

    await saveTask(client, { draft: draft({ expectedDate: '2026-09-29' }) });

    expect(rpcArgsOf(calls)).toMatchObject({
      p_scheduled_date: '2026-09-30',
      p_expected_date: '2026-09-29',
    });
  });

  test('the «save it anyway» retry sends it too', async () => {
    const { client, calls } = recordingClient(row);

    await saveTask(client, { draft: draft({ expectedDate: '2026-09-29' }), allowDuplicate: true });

    expect(rpcArgsOf(calls)).toMatchObject({
      p_allow_duplicate: true,
      p_expected_date: '2026-09-29',
    });
  });

  test('a new task sends none: there is no day it stood on', async () => {
    const { client, calls } = recordingClient(row);

    await saveTask(client, { draft: draft({ expectedDate: null }) });

    expect(rpcArgsOf(calls).p_expected_date).toBeUndefined();
  });
});
