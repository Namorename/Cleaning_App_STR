import {
  DUE_DAYS_AHEAD,
  OVERDUE_AFTER_DAYS,
  compareQueue,
  dayOfInstant,
  orderQueue,
  plannedDay,
  plannedTail,
  queueDay,
  tailDay,
  type QueueFacts,
} from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

/**
 * The technicians' queue (owner, 2026-11-26; packages/shared, problems/queue.ts): one order for
 * every queue of both apps, and the planned day under the repair's «Висит» and «Просрочено». Run
 * here because the shared package has no runner of its own.
 */

interface Named extends QueueFacts {
  readonly name: string;
}

const PRAGUE = { timezone: 'Europe/Prague' };

const task = (name: string, facts: Partial<QueueFacts>): Named => ({
  name,
  priority: 'normal',
  created_at: '2026-11-20T10:00:00Z',
  property: PRAGUE,
  ...facts,
});

const names = (tasks: readonly Named[]) => tasks.map((one) => one.name);

describe('the day a task stands on', () => {
  test('is its planned day when it has one', () => {
    expect(queueDay(task('a', { due_on: '2026-12-04' }))).toBe('2026-12-04');
  });

  test('is the day it was made in its listing’s zone otherwise', () => {
    // 23:30 UTC on 20.11 is already 21.11 in Prague (winter time, UTC+1).
    const late = task('a', { created_at: '2026-11-20T23:30:00Z' });
    expect(queueDay(late)).toBe('2026-11-21');
    expect(dayOfInstant('2026-11-20T23:30:00Z', 'UTC')).toBe('2026-11-20');
  });

  test('a row an older build cached, without the field, reads as nothing planned', () => {
    const cached = task('a', {});
    expect(cached).not.toHaveProperty('due_on');
    expect(queueDay(cached)).toBe('2026-11-20');
  });
});

describe('the order of the queue', () => {
  test('the earlier day first: a task planned ahead stands below today’s work', () => {
    const ordered = orderQueue([
      task('planned', { due_on: '2026-11-27', created_at: '2026-11-01T10:00:00Z' }),
      task('made today', { created_at: '2026-11-26T09:00:00Z' }),
      task('made last week', { created_at: '2026-11-19T09:00:00Z' }),
    ]);
    expect(names(ordered)).toEqual(['made last week', 'made today', 'planned']);
  });

  test('on one day by level: critical, high, normal, low', () => {
    const ordered = orderQueue([
      task('low', { priority: 'low' }),
      task('normal', { priority: 'normal' }),
      task('critical', { priority: 'high', critical: true }),
      task('high', { priority: 'high' }),
    ]);
    expect(names(ordered)).toEqual(['critical', 'high', 'normal', 'low']);
  });

  test('the flag counts only with high, as the database holds it', () => {
    const ordered = orderQueue([
      task('normal flagged', { priority: 'normal', critical: true }),
      task('high', { priority: 'high' }),
    ]);
    expect(names(ordered)).toEqual(['high', 'normal flagged']);
  });

  test('on one day and level the older first', () => {
    const ordered = orderQueue([
      task('newer', { created_at: '2026-11-20T12:00:00Z' }),
      task('older', { created_at: '2026-11-20T08:00:00Z' }),
    ]);
    expect(names(ordered)).toEqual(['older', 'newer']);
  });

  test('a planned day and a day made count alike: the day first, the level after', () => {
    const ordered = orderQueue([
      task('made on the 20th, normal', { created_at: '2026-11-20T08:00:00Z' }),
      task('planned for the 20th, high', {
        priority: 'high',
        created_at: '2026-11-22T08:00:00Z',
        due_on: '2026-11-20',
      }),
    ]);
    expect(names(ordered)).toEqual(['planned for the 20th, high', 'made on the 20th, normal']);
  });

  test('hands back a new array and leaves the one given as it was', () => {
    const given = [task('b', { created_at: '2026-11-21T08:00:00Z' }), task('a', {})];
    const ordered = orderQueue(given);
    expect(ordered).not.toBe(given);
    expect(names(given)).toEqual(['b', 'a']);
    expect(compareQueue(given[1], given[0])).toBeLessThan(0);
  });
});

describe('the day a live repair hangs from', () => {
  test('is the repair’s own day without a planned day', () => {
    expect(tailDay('2026-11-20', null)).toBe('2026-11-20');
    expect(tailDay('2026-11-20', undefined)).toBe('2026-11-20');
  });

  test('is the planned day when that is later, the repair’s when that is', () => {
    expect(tailDay('2026-11-20', '2026-11-24')).toBe('2026-11-24');
    expect(tailDay('2026-11-24', '2026-11-20')).toBe('2026-11-24');
  });

  test('is none without a repair day', () => {
    expect(tailDay(null, '2026-11-24')).toBeNull();
    expect(plannedTail(null, '2026-11-24', '2026-11-26')).toBeNull();
  });

  test('a repair booked early for a day planned ahead neither hangs nor is overdue', () => {
    expect(plannedTail('2026-11-01', '2026-11-28', '2026-11-26')).toBeNull();
    expect(plannedTail('2026-11-01', '2026-11-26', '2026-11-26')).toBeNull();
  });

  test('once the planned day has passed it hangs from it, overdue from the third day', () => {
    expect(plannedTail('2026-11-01', '2026-11-24', '2026-11-26')).toEqual({
      days: 2,
      isOverdue: false,
    });
    expect(plannedTail('2026-11-01', '2026-11-23', '2026-11-26')).toEqual({
      days: OVERDUE_AFTER_DAYS,
      isOverdue: true,
    });
  });

  test('without a planned day it is the rule of before', () => {
    expect(plannedTail('2026-11-20', null, '2026-11-26')).toEqual({ days: 6, isOverdue: true });
  });
});

describe('a planned day as a label reads it', () => {
  test('today and tomorrow by name, across a month and a year too', () => {
    expect(plannedDay('2026-11-26', '2026-11-26')).toEqual({ kind: 'today' });
    expect(plannedDay('2026-11-27', '2026-11-26')).toEqual({ kind: 'tomorrow' });
    expect(plannedDay('2026-12-01', '2026-11-30')).toEqual({ kind: 'tomorrow' });
    expect(plannedDay('2027-01-01', '2026-12-31')).toEqual({ kind: 'tomorrow' });
  });

  test('any other day by itself, past or later', () => {
    expect(plannedDay('2026-11-28', '2026-11-26')).toEqual({ kind: 'later', day: '2026-11-28' });
    expect(plannedDay('2026-11-25', '2026-11-26')).toEqual({ kind: 'past', day: '2026-11-25' });
  });

  test('nothing planned is no label', () => {
    expect(plannedDay(null, '2026-11-26')).toBeNull();
    expect(plannedDay(undefined, '2026-11-26')).toBeNull();
  });

  test('the office plans up to a year ahead, as the server checks', () => {
    expect(DUE_DAYS_AHEAD).toBe(366);
  });
});
