import type { Enums } from '../database.types';

/**
 * The urgency of a task (problem) on the product's scale of four, the most
 * urgent last (owner, 2026-11-15): «Критическая» stands above «Высокая».
 *
 * The database keeps it as the old priority of three values plus a flag
 * (20261115090000): a critical task reads `priority = 'high'` and
 * `critical = true`. An app, a panel or an API client that knows three levels
 * reads such a task as high — the phones of older builds parse `priority`
 * through a strict enum of three inside the list, and one value they did not
 * know would fail the whole list. Everything that acts on `priority` alone (the
 * head technician's push at night, «Срочно») treats a critical task as a high
 * one, which is what the level means.
 */
export const PROBLEM_LEVELS = ['low', 'normal', 'high', 'critical'] as const;
export type ProblemLevel = (typeof PROBLEM_LEVELS)[number];

type StoredPriority = Enums<'problem_priority'>;

/** What the server stores for a task's urgency: the priority, and the flag over it. */
export interface StoredUrgency {
  readonly priority: StoredPriority;
  /** Absent in a row written before the level, or cached by an older build. */
  readonly critical?: boolean | null;
}

/** The level a stored pair means; the flag counts only with `high`, as the database holds it. */
export function problemLevel({ priority, critical }: StoredUrgency): ProblemLevel {
  return critical === true && priority === 'high' ? 'critical' : priority;
}

/** The pair a level is stored as: critical is `high` with the flag. */
export function storedUrgency(level: ProblemLevel): {
  priority: StoredPriority;
  critical: boolean;
} {
  return level === 'critical'
    ? { priority: 'high', critical: true }
    : { priority: level, critical: false };
}

/** 1 for low up to 4 for critical: the more urgent, the greater. */
export function problemLevelRank(level: ProblemLevel): number {
  return PROBLEM_LEVELS.indexOf(level) + 1;
}

/** For `sort`: the more urgent first, critical before high. */
export function byUrgencyFirst(left: ProblemLevel, right: ProblemLevel): number {
  return problemLevelRank(right) - problemLevelRank(left);
}
