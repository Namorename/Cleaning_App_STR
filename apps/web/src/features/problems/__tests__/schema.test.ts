import { describe, expect, test } from 'vitest';

import {
  boardMove,
  isDraggable,
  isProblemClosed,
  liveFixTask,
  matchesQuery,
  problemSchema,
  stepState,
  type Problem,
} from '../schema';

const PROBLEM_ID = '11111111-1111-4111-8111-111111111111';
const REPORTER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const TECH_ID = '44444444-4444-4444-8444-444444444444';

const row = {
  id: PROBLEM_ID,
  property_id: 7,
  task_id: null,
  reported_by: REPORTER_ID,
  title: 'Течёт кран',
  description: 'На кухне',
  priority: 'high',
  status: 'assigned',
  resolved_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-09-09T10:00:00+00:00',
  property: { name: 'Vinohrady 12' },
  reporter: { full_name: 'Maria Test' },
  fix_tasks: [
    {
      id: TASK_ID,
      assignee_id: TECH_ID,
      status: 'assigned',
      scheduled_date: '2026-09-10',
      time_from: '09:00:00',
      time_to: null,
      assignee: { full_name: 'Petr Fixer' },
    },
  ],
};

describe('problemSchema', () => {
  test('parses a joined row and defaults missing joins', () => {
    const parsed = problemSchema.parse(row);
    expect(parsed.property?.name).toBe('Vinohrady 12');
    expect(parsed.fix_tasks[0]?.assignee?.full_name).toBe('Petr Fixer');

    const bare = problemSchema.parse({
      ...row,
      property: undefined,
      reporter: undefined,
      fix_tasks: undefined,
    });
    expect(bare.fix_tasks).toEqual([]);
  });

  test('rejects a status the panel does not know', () => {
    expect(() => problemSchema.parse({ ...row, status: 'lost' })).toThrow();
  });
});

describe('liveFixTask', () => {
  test('returns the attempt that is not closed and ignores cancelled ones', () => {
    const problem: Problem = problemSchema.parse({
      ...row,
      fix_tasks: [{ ...row.fix_tasks[0], id: TECH_ID, status: 'cancelled' }, row.fix_tasks[0]],
    });
    expect(liveFixTask(problem)?.id).toBe(TASK_ID);
  });

  test('returns null when every attempt is over', () => {
    const problem = problemSchema.parse({
      ...row,
      fix_tasks: [{ ...row.fix_tasks[0], status: 'done' }],
    });
    expect(liveFixTask(problem)).toBeNull();
  });
});

describe('matchesQuery', () => {
  const problem = problemSchema.parse(row);

  test('matches the title or the listing name, ignoring case', () => {
    expect(matchesQuery(problem, 'КРАН')).toBe(true);
    expect(matchesQuery(problem, 'vinohrady')).toBe(true);
    expect(matchesQuery(problem, 'балкон')).toBe(false);
  });

  test('keeps everything for an empty query', () => {
    expect(matchesQuery(problem, '   ')).toBe(true);
  });
});

describe('stepState', () => {
  test('reads done before waived before skipped before pending', () => {
    const at = '2026-09-09T10:00:00+00:00';
    expect(stepState({ completed_at: at, skipped_at: at, waived_at: at })).toBe('done');
    expect(stepState({ completed_at: null, skipped_at: at, waived_at: at })).toBe('waived');
    expect(stepState({ completed_at: null, skipped_at: at, waived_at: null })).toBe('skipped');
    expect(stepState({ completed_at: null, skipped_at: null, waived_at: null })).toBe('pending');
  });
});

describe('boardMove', () => {
  test('maps a drop to the one thing the server can do about it', () => {
    expect(boardMove('open', 'assigned')).toBe('assign');
    expect(boardMove('open', 'resolved')).toBe('resolve');
    expect(boardMove('assigned', 'open')).toBe('unassign');
    expect(boardMove('in_progress', 'open')).toBe('unassign');
    expect(boardMove('in_progress', 'resolved')).toBe('resolve');
  });

  test('refuses what only the technician or nobody can do', () => {
    expect(boardMove('open', 'in_progress')).toBe('startOnPhone');
    expect(boardMove('in_progress', 'assigned')).toBeNull();
    expect(boardMove('open', 'open')).toBeNull();
    expect(boardMove('cancelled', 'resolved')).toBeNull();
    expect(boardMove('cancelled', 'open')).toBeNull();
  });

  test('a resolved problem goes back to open and nowhere else', () => {
    expect(boardMove('resolved', 'open')).toBe('reopen');
    expect(boardMove('resolved', 'assigned')).toBeNull();
    expect(boardMove('resolved', 'in_progress')).toBeNull();
  });

  test('only cancelled problems cannot be picked up', () => {
    expect(isDraggable({ status: 'open' })).toBe(true);
    expect(isDraggable({ status: 'resolved' })).toBe(true);
    expect(isDraggable({ status: 'cancelled' })).toBe(false);
  });
});

describe('isProblemClosed', () => {
  test('is true for resolved and cancelled only', () => {
    expect(isProblemClosed({ status: 'resolved' })).toBe(true);
    expect(isProblemClosed({ status: 'cancelled' })).toBe(true);
    expect(isProblemClosed({ status: 'in_progress' })).toBe(false);
  });
});
