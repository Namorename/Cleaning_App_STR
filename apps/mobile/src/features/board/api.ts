import { calendarDay } from '@/features/tasks/schema';
import { supabase } from '@/lib/supabase';

import {
  boardProblemListSchema,
  staffListSchema,
  type BoardProblem,
  type BoardRead,
  type StaffMember,
} from './schema';

/**
 * A task as the board shows it: its status and archive stamp, the place with
 * the house above a room, and its repairs with who holds each, the day and the
 * hours. No people embedded: profiles are closed to the head technician, and
 * names come from `staff_directory` (20261003120000).
 */
const BOARD_COLUMNS =
  'id, property_id, title, priority, status, archived_at, created_at, ' +
  'property:properties(name, hostaway_unit_id, parent:parent_id(name)), ' +
  'fix_tasks:tasks!tasks_problem_id_fkey(id, type, assignee_id, status, scheduled_date, time_from, time_to)';

/** How long a closed task stays on the board: the last month's work. */
export const CLOSED_WINDOW_DAYS = 30;

/** How many archived tasks one «Ещё» brings. */
export const ARCHIVE_PAGE_SIZE = 50;

/**
 * The most tasks not yet closed the board shows, newest first (item 11 of
 * the two whole-branch reviews): a company that falls behind only adds to
 * what is live. One under the thousand rows the server returns at most for a
 * read (`max_rows`, supabase/config.toml): the board asks for one more than
 * it shows, and that one has to fit.
 */
export const BOARD_OPEN_LIMIT = 999;

/** The most tasks closed in the window the board shows, newest first. */
export const BOARD_CLOSED_LIMIT = 200;

/** The statuses that close a task; any other — one a newer server adds too — is still work. */
const CLOSED_STATUS_LIST = ['resolved', 'cancelled'] as const;
const CLOSED_STATUSES = `(${CLOSED_STATUS_LIST.join(',')})`;

/**
 * The company's tasks still on the board: everything not closed, then what
 * was closed in the last thirty days, each newest first — row level security
 * draws the line, for the head technician all of the company (decisions 7 and
 * 15). A company's tasks only grow, so the board does not read them all: the
 * archive is `fetchArchivePage`, on demand. «Closed in the window» is the
 * row's last change (`updated_at`, never null, touched by the closing
 * itself), a day on the phone's calendar.
 *
 * Two reads, each to its own limit and one more (the verification review of
 * f3217a7..c466bf5, item 3): one limit on both, newest first, dropped a task
 * still open from five weeks ago before last week's closed ones. The one more
 * is how the board knows a part was cut (`cutBoard`); it is handed back with
 * the rest.
 *
 * The two go out together, so a task closed between them can be in both:
 * it is handed back once, as the read of open tasks has it — work, until the
 * next refresh says otherwise (the verification review of c466bf5..bc7dcc9,
 * item 7). Whether each read was cut is said as it answered, before that:
 * dropped from the closed rows, the task took a closed read cut at its limit
 * and one more down to its limit, and the board said nothing of the cut
 * (night journal, review of bc7dcc9..dab5237).
 */
export async function fetchBoardProblems(now: Date = new Date()): Promise<BoardRead> {
  const since = calendarDay(now, -CLOSED_WINDOW_DAYS);
  const [open, closed] = await Promise.all([
    supabase
      .from('problems')
      .select(BOARD_COLUMNS)
      .is('archived_at', null)
      .not('status', 'in', CLOSED_STATUSES)
      .order('created_at', { ascending: false })
      .limit(BOARD_OPEN_LIMIT + 1),
    supabase
      .from('problems')
      .select(BOARD_COLUMNS)
      .is('archived_at', null)
      .in('status', [...CLOSED_STATUS_LIST])
      .gte('updated_at', since)
      .order('created_at', { ascending: false })
      .limit(BOARD_CLOSED_LIMIT + 1),
  ]);

  if (open.error) {
    throw open.error;
  }
  if (closed.error) {
    throw closed.error;
  }

  const openRows = boardProblemListSchema.parse(open.data ?? []);
  const closedRead = boardProblemListSchema.parse(closed.data ?? []);
  const openIds = new Set(openRows.map((problem) => problem.id));
  const closedRows = closedRead.filter((problem) => !openIds.has(problem.id));
  return {
    problems: [...openRows, ...closedRows],
    isOpenCut: openRows.length > BOARD_OPEN_LIMIT,
    isClosedCut: closedRead.length > BOARD_CLOSED_LIMIT,
  };
}

/**
 * One page of the archive (decision 7), newest first; `page` counts from 0.
 * Ordered to the id as well, so a page boundary never repeats or skips a task
 * created in the same instant as another.
 */
export async function fetchArchivePage(page: number): Promise<BoardProblem[]> {
  const first = page * ARCHIVE_PAGE_SIZE;
  const { data, error } = await supabase
    .from('problems')
    .select(BOARD_COLUMNS)
    .not('archived_at', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(first, first + ARCHIVE_PAGE_SIZE - 1);

  if (error) {
    throw error;
  }

  return boardProblemListSchema.parse(data ?? []);
}

/** One task as the board reads it, for the dispatch on its screen; null when there is none. */
export async function fetchBoardProblem(problemId: string): Promise<BoardProblem | null> {
  const { data, error } = await supabase.from('problems').select(BOARD_COLUMNS).eq('id', problemId);

  if (error) {
    throw error;
  }

  return boardProblemListSchema.parse(data ?? [])[0] ?? null;
}

/** The company's people by name and role — nothing for anybody but him and the manager. */
export async function fetchStaffDirectory(): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc('staff_directory');

  if (error) {
    throw error;
  }

  return staffListSchema.parse(data ?? []);
}

export interface AssignProblemVariables {
  problemId: string;
  assigneeId: string;
  /** `YYYY-MM-DD`, the day chosen on the sheet. */
  scheduledDate: string;
  /** The hours the live repair already has, sent back as they are; null for none. */
  timeFrom: string | null;
  timeTo: string | null;
}

/**
 * Hand the task to a technician for a day (assign_problem, 20261003130000).
 * The server answers with the task, which nobody reads: the screens fetch
 * again, as they would after any move of the office.
 */
export async function assignProblem(variables: AssignProblemVariables): Promise<void> {
  const { error } = await supabase.rpc('assign_problem', {
    p_id: variables.problemId,
    p_assignee_id: variables.assigneeId,
    p_scheduled_date: variables.scheduledDate,
    p_time_from: variables.timeFrom ?? undefined,
    p_time_to: variables.timeTo ?? undefined,
  });

  if (error) {
    throw error;
  }
}

export interface UnassignProblemVariables {
  taskId: string;
  /**
   * Who the screen showed on the repair. A repair that holds somebody else by
   * now is refused (`taskChangedMeanwhile`): nobody is taken off whom the
   * head technician never saw on it.
   */
  expectedAssigneeId: string;
}

/** Take the person off the repair: it is cancelled, and the task waits again. */
export async function unassignProblem(variables: UnassignProblemVariables): Promise<void> {
  const { error } = await supabase.rpc('unassign_problem', {
    p_task_id: variables.taskId,
    p_expected_assignee: variables.expectedAssigneeId,
  });

  if (error) {
    throw error;
  }
}
