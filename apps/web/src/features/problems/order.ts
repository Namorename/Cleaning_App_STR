import { orderQueue, orderTaskHistory } from '@str-ops/shared';

import {
  isProblemClosed,
  liveFixTask,
  problemPlace,
  type BoardStatus,
  type Problem,
} from './schema';

/**
 * The order of «Задания» (owner, 2026-11-26 and 2026-11-27; packages/shared, problems/queue.ts
 * and schedule/day-place-order.ts): the day, then the property by its name as the row shows it
 * (the house and the room, `problemPlace`), a task with no property last in its day, then the
 * level. The work still to do stands on the day its row shows — on the board the technician's
 * day of its work, else its planned day, else the day it was made — the earlier first, the older
 * first within a property; the history keeps the later day first, the newer first within a
 * property. Pure functions over what the page read.
 */

/** The moment a task in «Выполнено» counts by: its resolution, else its report. */
function resolvedAt(problem: Problem): string {
  return problem.resolved_at ?? problem.created_at;
}

/** The technician's day a card shows beside the name: its live work's, if it has one. */
function workDayOf(problem: Problem): string | null {
  return liveFixTask(problem)?.scheduled_date ?? null;
}

/**
 * A board column's cards in its order: the three live columns in the queue's order, «Выполнено»
 * by the day resolved, the latest first (owner, 10.10), then the property. A live card with work
 * stands on the technician's day it shows (owner, 2026-11-27: «Задания не отсортированы»), not
 * on the day it was made, which the card does not show.
 */
export function columnOrder(
  problems: readonly Problem[],
  status: BoardStatus,
  language: string,
): Problem[] {
  const cards = problems.filter((problem) => problem.status === status);
  return status === 'resolved'
    ? orderTaskHistory(cards, { at: resolvedAt, place: problemPlace, language })
    : orderQueue(cards, { language, workDay: workDayOf });
}

/**
 * The list's rows: the live tasks first, in the queue's order, then the closed ones — resolved
 * and cancelled — by the day reported, the latest first as read (fetchProblems), then the property.
 */
export function listOrder(problems: readonly Problem[], language: string): Problem[] {
  const live = problems.filter((problem) => !isProblemClosed(problem));
  const closed = problems.filter(isProblemClosed);
  return [
    ...orderQueue(live, { language }),
    ...orderTaskHistory(closed, { place: problemPlace, language }),
  ];
}
