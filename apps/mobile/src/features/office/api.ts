import { TASK_COLUMNS, fetchTask } from '@/features/tasks/api';
import { RefusalError } from '@/lib/server-error';
import { supabase } from '@/lib/supabase';

import {
  MAX_RANGE_DAYS,
  isRangeAllowed,
  officeTaskListSchema,
  type DayRange,
  type OfficeTask,
} from './schema';

/**
 * A cleaning as the office reads it: the cleaner's columns — the place with
 * its house, the report a repair fixes, the closing — and three of the
 * office's own, as the panel asks for them (apps/web/src/features/tasks/api.ts):
 * the person on it by name, the stamp of the office's cancel and the kind of a
 * hand-back, and who took it off and why (`task_offs`, null for anybody but
 * the office). The assignee is hinted by the constraint: tasks and profiles
 * are joined twice (the assignee and the author).
 */
export const OFFICE_TASK_COLUMNS =
  `${TASK_COLUMNS}, ` +
  'assignee:profiles!tasks_assignee_id_fkey(full_name), ' +
  'cancelled_at, release_kind, offs:task_offs';

/** One page of a read: under the thousand rows the server answers at most. */
const PAGE_SIZE = 500;

/** Two months of a large company stay well under this; a loop never runs away. */
const MAX_PAGES = 20;

/**
 * The company's cleanings on the days `from` up to `to` (exclusive), for the
 * office's «Уборки». Row level security shows a manager every one.
 *
 * The same rows as the panel's «Уборки» (owner, 2026-11-05): every kind of
 * job but the repair of a task — that is «Задания»' work — and every status;
 * the screen leaves the cancelled out unless asked (schema.ts, `matchesStatus`).
 *
 * Read page by page, sorted to the id last so pages tile without a gap: two
 * months of a busy company are more than one answer of the server holds.
 */
export async function fetchOfficeTasks(range: DayRange): Promise<OfficeTask[]> {
  if (!isRangeAllowed(range)) {
    throw new RangeError(
      `The office reads 1 to ${MAX_RANGE_DAYS} days at once, not ${range.from}..${range.to}`,
    );
  }

  let rows: OfficeTask[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const first = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('tasks')
      .select(OFFICE_TASK_COLUMNS)
      .is('problem_id', null)
      .gte('scheduled_date', range.from)
      .lt('scheduled_date', range.to)
      .order('scheduled_date', { ascending: true })
      .order('time_from', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(first, first + PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const read = officeTaskListSchema.parse(data ?? []);
    rows = [...rows, ...read];
    if (read.length < PAGE_SIZE) {
      return rows;
    }
  }
  return rows;
}

/**
 * One job as the office reads it, for its card; null when there is no row to
 * see. A repair too: a push or the task's screen may open one.
 */
export async function fetchOfficeTask(taskId: string): Promise<OfficeTask | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select(OFFICE_TASK_COLUMNS)
    .eq('id', taskId);

  if (error) {
    throw error;
  }

  return officeTaskListSchema.parse(data ?? [])[0] ?? null;
}

export interface AssignCleaningVariables {
  taskId: string;
  /** The cleaner it goes to. */
  assigneeId: string;
  /** The day the card showed the cleaning on, `YYYY-MM-DD`. */
  shownDate: string;
}

/**
 * «Назначить» / «Переназначить»: only the person changes. save_task is the
 * panel's one writer of a cleaning, called as the public API's
 * `api_v1_assign_cleaning` calls it (20261028100000): every other field as
 * the cleaning has it now — read again just before, so a title or a note the
 * panel changed since the card was read is not written back over — the
 * duplicate question answered (the cleaning is already there), and the day
 * both kept and expected. Expected as the card showed it: a cleaning moved
 * meanwhile is refused (`serverErrors.taskMovedMeanwhile`) rather than handed
 * to a person on a day the manager never saw.
 *
 * Arguments by name, nothing said of the translations or the priority: an
 * omitted argument leaves them as they are. The server refuses a closed
 * cleaning (taskClosed), a person switched off or of another company
 * (taskAssigneeInvalid), and a technician (cleaningNotForTech). It answers
 * with the bare row, which nobody reads: the screens read it again.
 */
export async function assignCleaning({
  taskId,
  assigneeId,
  shownDate,
}: AssignCleaningVariables): Promise<void> {
  const row = await fetchTask(taskId);
  if (row === null) {
    throw new RefusalError(`Task ${taskId} is not to be seen`, 'serverErrors.taskNotFound');
  }

  const { error } = await supabase.rpc('save_task', {
    p_id: row.id,
    p_property_id: row.property_id,
    p_type: row.type,
    p_scheduled_date: shownDate,
    p_title: row.title ?? undefined,
    p_assignee_id: assigneeId,
    p_time_from: row.time_from ?? undefined,
    p_time_to: row.time_to ?? undefined,
    p_notes: row.notes ?? undefined,
    p_allow_duplicate: true,
    p_expected_date: shownDate,
  });

  if (error) {
    throw error;
  }
}

/**
 * «Вернуть»: a cleaning the office cancelled goes back to the status and the
 * person it had (restore_cleaning, 20261118120000). Refused when its booking
 * has another cleaning of the place meanwhile (cleaningRestoreTaken).
 */
export async function restoreCleaning(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_cleaning', { p_task_id: taskId });

  if (error) {
    throw error;
  }
}
