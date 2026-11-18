import type { TaskStatus } from '@str-ops/shared';

import type { CleaningTask } from './schema';

/**
 * How a cleaning is taken off (20261118120000, docs/rollout/cleaning-offs-1118.md):
 *
 * - `decline` — she hands back a cleaning of hers she has not started;
 * - `interrupt` — she hands back one under way, its steps and photos kept;
 * - `cancel` — the office cancels a cleaning, whatever its status.
 *
 * No new status comes of any of them: a hand-back leaves the cleaning
 * «unassigned» with nobody on it, a cancel «cancelled», as before.
 */
export type CleaningOffKind = 'decline' | 'interrupt' | 'cancel';

/** The longest reason the server keeps (task_events.reason). */
export const MAX_OFF_REASON_LENGTH = 500;

/** Given or accepted, not started: what decline_cleaning takes. */
const DECLINABLE: readonly TaskStatus[] = ['assigned', 'accepted'];

/** Under way, stopped or not: what interrupt_cleaning takes. */
const INTERRUPTIBLE: readonly TaskStatus[] = ['in_progress', 'paused', 'blocked'];

/**
 * The ways off this job offered to the person holding the phone, in the order
 * the screen shows them; `isOffice` is a manager's or an admin's phone.
 *
 * Mirrors what the server takes, and the server decides: a screen that has
 * not caught up is refused (`serverErrors.taskChangedMeanwhile`). A repair of
 * a task is called off with its task (cancel_problem), never here; a row read
 * before `problem_id` was asked for (undefined) offers nothing until the
 * screen's own read says it is not one.
 */
export function cleaningOffs(
  task: CleaningTask,
  userId: string,
  isOffice: boolean,
): readonly CleaningOffKind[] {
  if (task.problem_id !== null) {
    return [];
  }
  const isHers = task.assignee_id === userId;
  const offered: readonly (readonly [CleaningOffKind, boolean])[] = [
    ['decline', isHers && DECLINABLE.includes(task.status)],
    ['interrupt', isHers && INTERRUPTIBLE.includes(task.status)],
    ['cancel', isOffice && task.status !== 'cancelled'],
  ];
  return offered.filter(([, isOffered]) => isOffered).map(([kind]) => kind);
}

/** An interrupt says why (`serverErrors.reasonRequired`); a decline and a cancel may. */
export function isReasonRequired(kind: CleaningOffKind): boolean {
  return kind === 'interrupt';
}

/** The words as sent: trimmed, and nothing written is no reason at all. */
export function reasonToSend(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}
