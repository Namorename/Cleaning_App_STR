import type { TFunction } from 'i18next';
import { describe, expect, test } from 'vitest';

import { canCancelCleaning, canRestoreCleaning, taskSchema, type Task } from '../schema';
import { hasOffLines, offLines } from '../task-offs';

/**
 * The office's cancel and a cleaner's hand-back, as the panel reads and offers them
 * (20261118120000): who may be called off and returned, what a row says, and what the schema
 * makes of a row that has the marks, lacks them, or carries them broken.
 */
const t = ((key: string, values?: Record<string, string>) =>
  values === undefined ? key : `${key} ${JSON.stringify(values)}`) as unknown as TFunction;

const base = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  property_id: 1,
  reservation_id: 7,
  problem_id: null,
  type: 'cleaning',
  status: 'assigned',
  assignee_id: null,
  scheduled_date: '2026-11-18',
  time_from: null,
  time_to: null,
  started_at: null,
  completed_at: null,
  measured_minutes: null,
  duration_override_min: null,
  notes: null,
  created_at: '2026-11-01T08:00:00+00:00',
};
const row = (overrides: Record<string, unknown>): Task =>
  taskSchema.parse({ ...base, ...overrides });

const BOSS = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'Boss', role: 'manager' };

describe('who may be called off and returned', () => {
  test.each(['unassigned', 'assigned', 'accepted', 'in_progress', 'done', 'expired'] as const)(
    'a cleaning %s may be called off',
    (status) => {
      expect(canCancelCleaning(row({ status }))).toBe(true);
    },
  );

  test('a cancelled one, or a repair of a task, may not', () => {
    expect(canCancelCleaning(row({ status: 'cancelled' }))).toBe(false);
    expect(canCancelCleaning(row({ problem_id: 'cccccccc-cccc-4ccc-8ccc-000000000001' }))).toBe(
      false,
    );
  });

  test('only the office cancel is returned, not a booking cancel', () => {
    expect(
      canRestoreCleaning(row({ status: 'cancelled', cancelled_at: '2026-11-18T10:00:00Z' })),
    ).toBe(true);
    expect(canRestoreCleaning(row({ status: 'cancelled' }))).toBe(false);
    expect(canRestoreCleaning(row({ cancelled_at: null }))).toBe(false);
  });
});

describe('what a row says', () => {
  test('an office cancel: who, when, and the words quoted', () => {
    const task = row({
      status: 'cancelled',
      cancelled_at: '2026-11-18T10:00:00Z',
      offs: {
        cancelled: { at: '2026-11-18T10:00:00Z', from: 'done', by: BOSS, reason: 'Owner cleans' },
        released: null,
      },
    });

    const lines = offLines(task, t, 'en');

    expect(hasOffLines(task)).toBe(true);
    expect(lines[0]).toContain('panel.tasks.offs.cancelled');
    expect(lines[0]).toContain('"name":"Boss"');
    expect(lines[1]).toBe('panel.tasks.offs.quoted {"reason":"Owner cleans"}');
  });

  test('a hand-back while nobody has it, by its kind; somebody unknown is «сотрудник»', () => {
    const task = row({
      status: 'unassigned',
      release_kind: 'interrupted',
      offs: {
        cancelled: null,
        released: { kind: 'interrupted', at: '2026-11-18T09:00:00Z', by: null, reason: null },
      },
    });

    expect(offLines(task, t, 'en')).toEqual([
      'panel.tasks.offs.interrupted {"name":"panel.tasks.offs.someone"}',
    ]);
  });

  test('a hand-back once somebody has it again says nothing', () => {
    const task = row({
      status: 'assigned',
      offs: {
        cancelled: null,
        released: { kind: 'declined', at: '2026-11-18T09:00:00Z', by: BOSS, reason: 'x' },
      },
    });

    expect(hasOffLines(task)).toBe(false);
    expect(offLines(task, t, 'en')).toEqual([]);
  });

  test('no marks, no lines — and none for a reader the server gives none', () => {
    expect(offLines(row({}), t, 'en')).toEqual([]);
    expect(hasOffLines(row({ status: 'cancelled' }))).toBe(false);
  });
});

describe('the schema', () => {
  test('a bare row of an RPC, without the marks, reads none', () => {
    const task = row({});

    expect([task.cancelled_at, task.release_kind, task.offs]).toEqual([null, null, null]);
  });

  test('broken marks read as none rather than failing the list', () => {
    const task = row({ release_kind: 'vanished', offs: { cancelled: 'x', released: 42 } });

    expect(task.release_kind).toBeNull();
    expect(task.offs).toEqual({ cancelled: null, released: null });
  });
});
