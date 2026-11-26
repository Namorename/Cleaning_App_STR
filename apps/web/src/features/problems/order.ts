import { orderQueue } from '@str-ops/shared';

import { isProblemClosed, type BoardStatus, type Problem } from './schema';

/**
 * The order of «Задания» (owner, 2026-11-26; packages/shared, problems/queue.ts): the work still
 * to do in the technicians' queue — the planned day, else the day the task was made, then the
 * level, then the older first. Pure functions over what the page read.
 */

/** When a task was resolved; one without the stamp counts from its report. */
function resolvedTime(problem: Problem): number {
  return Date.parse(problem.resolved_at ?? problem.created_at);
}

/**
 * A board column's cards in its order: the three live columns in the queue's order, «Выполнено»
 * newest resolved first (owner, 10.10).
 */
export function columnOrder(problems: readonly Problem[], status: BoardStatus): Problem[] {
  const cards = problems.filter((problem) => problem.status === status);
  return status === 'resolved'
    ? [...cards].sort((left, right) => resolvedTime(right) - resolvedTime(left))
    : orderQueue(cards);
}

/**
 * The list's rows: the live tasks first, in the queue's order, then the closed ones — resolved
 * and cancelled — in the order they came, newest reported first as read (fetchProblems).
 */
export function listOrder(problems: readonly Problem[]): Problem[] {
  const live = problems.filter((problem) => !isProblemClosed(problem));
  return [...orderQueue(live), ...problems.filter(isProblemClosed)];
}
