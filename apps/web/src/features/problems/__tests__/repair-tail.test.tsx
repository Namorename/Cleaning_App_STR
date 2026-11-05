import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ProblemCard } from '../problem-card';
import { ProblemsTable } from '../problems-table';
import { problemSchema, repairTail, type Problem } from '../schema';

vi.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ problems: new Set(), tasks: new Set() }),
}));

const PROBLEM_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const TECH_ID = '44444444-4444-4444-8444-444444444444';

// Noon in Prague on 05.11: the listing's today is 2026-11-05.
const NOW = new Date('2026-11-05T11:00:00Z');

function problemWith(
  scheduledDate: string,
  overrides: { status?: string; taskStatus?: string; timezone?: string | null } = {},
): Problem {
  return problemSchema.parse({
    id: PROBLEM_ID,
    property_id: 7,
    task_id: null,
    reported_by: null,
    title: 'Течёт кран',
    description: null,
    priority: 'normal',
    status: overrides.status ?? 'assigned',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-10-20T10:00:00+00:00',
    property: {
      name: 'Vinohrady 12',
      timezone: overrides.timezone === undefined ? 'Europe/Prague' : overrides.timezone,
    },
    fix_tasks: [
      {
        id: TASK_ID,
        assignee_id: TECH_ID,
        status: overrides.taskStatus ?? 'assigned',
        scheduled_date: scheduledDate,
        time_from: null,
        time_to: null,
        assignee: { full_name: 'Petr Fixer', role: 'tech' },
      },
    ],
  });
}

/**
 * A repair is «Задания»' work since «Уборки» stopped listing it (owner,
 * 2026-11-05), and the day rule went with it: «Висит N дней» from the day
 * after, «Просрочено» from OVERDUE_AFTER_DAYS on, in the listing's zone.
 */
describe('how long a repair has hung', () => {
  test('nothing while its day has not passed', () => {
    expect(repairTail(problemWith('2026-11-05'), NOW)).toBeNull();
    expect(repairTail(problemWith('2026-11-07'), NOW)).toBeNull();
  });

  test('days from the day after, overdue from the third', () => {
    expect(repairTail(problemWith('2026-11-04'), NOW)).toEqual({ days: 1, isOverdue: false });
    expect(repairTail(problemWith('2026-11-03'), NOW)).toEqual({ days: 2, isOverdue: false });
    expect(repairTail(problemWith('2026-11-02'), NOW)).toEqual({ days: 3, isOverdue: true });
  });

  test("counted by the listing's calendar, not the browser's", () => {
    // 23:30 UTC on 04.11 is already 05.11 in Prague (winter time, +1).
    const lateEvening = new Date('2026-11-04T23:30:00Z');

    expect(repairTail(problemWith('2026-11-02'), lateEvening)).toEqual({
      days: 3,
      isOverdue: true,
    });
    expect(repairTail(problemWith('2026-11-02', { timezone: 'UTC' }), lateEvening)).toEqual({
      days: 2,
      isOverdue: false,
    });
  });

  test('a closed task, or one with no live repair, waits for nothing', () => {
    expect(repairTail(problemWith('2026-10-20', { status: 'resolved' }), NOW)).toBeNull();
    expect(repairTail(problemWith('2026-10-20', { status: 'cancelled' }), NOW)).toBeNull();
    expect(repairTail(problemWith('2026-10-20', { taskStatus: 'done' }), NOW)).toBeNull();
    expect(repairTail(problemWith('2026-10-20', { taskStatus: 'cancelled' }), NOW)).toBeNull();
  });
});

describe('the marks in «Задания»', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  test('the board card: hanging, not yet overdue', () => {
    render(<ProblemCard problem={problemWith('2026-11-03')} />);

    expect(screen.getByText('Висит 2 дня')).toBeInTheDocument();
    expect(screen.queryByText('Просрочено')).not.toBeInTheDocument();
  });

  test('the board card: overdue from the third day', () => {
    render(<ProblemCard problem={problemWith('2026-10-31')} />);

    expect(screen.getByText('Просрочено')).toBeInTheDocument();
    expect(screen.getByText('Висит 5 дней')).toBeInTheDocument();
  });

  test('the board card: a repair on today says nothing of days', () => {
    render(<ProblemCard problem={problemWith('2026-11-05')} />);

    expect(screen.queryByText(/Висит/)).not.toBeInTheDocument();
    expect(screen.queryByText('Просрочено')).not.toBeInTheDocument();
  });

  test('the list: beside the person on the repair', () => {
    render(<ProblemsTable problems={[problemWith('2026-11-01')]} />);

    expect(screen.getByText('Просрочено')).toBeInTheDocument();
    expect(screen.getByText('Висит 4 дня')).toBeInTheDocument();
  });
});
