import { z } from 'zod';

import { PROBLEM_PRIORITIES, PROBLEM_STATUSES } from '@/features/problems/schema';

/**
 * The head technician's board (docs/tech-plan.md §3.4, §4): every task
 * (problem) of the company — the archive too (decision 7) — with the repairs
 * he may read, and the people of the company by name (`staff_directory`:
 * profiles stay closed to him). Each key a later build adds carries a
 * `.default`, so a board saved on the phone by this build still reads.
 */

/** A repair's statuses that end it: a task's live repair is any other. */
const OVER: ReadonlySet<string> = new Set(['done', 'cancelled', 'expired']);

/** The kind of job that repairs a task; the only one assign_problem looks for. */
const REPAIR = 'maintenance';

export const boardRepairSchema = z.object({
  id: z.string().uuid(),
  type: z.string().default(REPAIR),
  assignee_id: z.string().uuid().nullable().default(null),
  status: z.string(),
  scheduled_date: z.string().nullable().default(null),
  time_from: z.string().nullable().default(null),
  time_to: z.string().nullable().default(null),
});

export type BoardRepair = z.infer<typeof boardRepairSchema>;

export const boardProblemSchema = z.object({
  id: z.string().uuid(),
  property_id: z.number().nullable(),
  title: z.string(),
  priority: z.enum(PROBLEM_PRIORITIES),
  status: z.enum(PROBLEM_STATUSES),
  archived_at: z.string().nullable().default(null),
  created_at: z.string(),
  // The house rides along, as on every place the phone names (problems/schema.ts).
  property: z
    .object({
      name: z.string(),
      hostaway_unit_id: z.number().nullable().default(null),
      parent: z.object({ name: z.string() }).nullable().default(null),
    })
    .nullable()
    .default(null),
  fix_tasks: z.array(boardRepairSchema).default([]),
});

export type BoardProblem = z.infer<typeof boardProblemSchema>;

export const boardProblemListSchema = z.array(boardProblemSchema);

/** One row of `staff_directory()`. A role a newer server invented is still a person. */
export const staffMemberSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  role: z.string(),
  is_active: z.boolean(),
});

export type StaffMember = z.infer<typeof staffMemberSchema>;

export const staffListSchema = z.array(staffMemberSchema);

/** The repair the task waits on now, or null: tasks_one_fix_per_problem allows one. */
export function liveRepair(problem: BoardProblem): BoardRepair | null {
  return problem.fix_tasks.find((task) => task.type === REPAIR && !OVER.has(task.status)) ?? null;
}

/** Who holds the live repair, or null. */
export function liveHolder(problem: BoardProblem): string | null {
  return liveRepair(problem)?.assignee_id ?? null;
}

export function isClosed(problem: BoardProblem): boolean {
  return problem.status === 'resolved' || problem.status === 'cancelled';
}

/** On the board and not yet closed: a task somebody still has to see to. */
export function isLive(problem: BoardProblem): boolean {
  return problem.archived_at === null && !isClosed(problem);
}

/** Open, out of the archive, and nobody on its repair: a task waiting to be handed out. */
export function isWaiting(problem: BoardProblem): boolean {
  return problem.status === 'open' && problem.archived_at === null && liveHolder(problem) === null;
}

/**
 * «Назначить»: a waiting task with a listing. Closing, cancelling and the
 * archive are the manager's (decision 1); an archived task, and one with no
 * listing to schedule it at, the server refuses (problemArchived,
 * problemNoProperty).
 */
export function canAssign(problem: BoardProblem): boolean {
  return isWaiting(problem) && problem.property_id !== null;
}

/** «Снять»: somebody holds the live repair — a technician, or a cleaner (decision 17). */
export function canTakeOff(problem: BoardProblem): boolean {
  return liveHolder(problem) !== null;
}

/** The status chips, in their order on the board. The archive is a filter of its own. */
export const BOARD_STATUS_FILTERS = [
  'all',
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'archived',
] as const;

export type BoardStatusFilter = (typeof BOARD_STATUS_FILTERS)[number];

export type AssigneeFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'nobody' }
  | { readonly kind: 'person'; readonly id: string };

export const ANY_ASSIGNEE: AssigneeFilter = { kind: 'all' };
export const NO_ASSIGNEE: AssigneeFilter = { kind: 'nobody' };

export interface BoardFilter {
  status: BoardStatusFilter;
  assignee: AssigneeFilter;
}

function matchesStatus(problem: BoardProblem, status: BoardStatusFilter): boolean {
  if (status === 'archived') {
    return problem.archived_at !== null;
  }
  if (problem.archived_at !== null) {
    return false;
  }
  return status === 'all' || problem.status === status;
}

function matchesAssignee(problem: BoardProblem, assignee: AssigneeFilter): boolean {
  switch (assignee.kind) {
    case 'all':
      return true;
    // Waiting for somebody: a closed task waits for nobody.
    case 'nobody':
      return isLive(problem) && liveHolder(problem) === null;
    case 'person':
      return liveHolder(problem) === assignee.id;
  }
}

/** The board as the two filters leave it, in the server's order (newest first). */
export function filterBoard(
  problems: readonly BoardProblem[],
  { status, assignee }: BoardFilter,
): BoardProblem[] {
  return problems.filter(
    (problem) => matchesStatus(problem, status) && matchesAssignee(problem, assignee),
  );
}

export interface BoardSection {
  key: 'active' | 'closed';
  data: BoardProblem[];
}

/** Live tasks first, the closed ones under their heading, as her own list has them. */
export function boardSections(problems: readonly BoardProblem[]): BoardSection[] {
  const active = problems.filter((problem) => !isClosed(problem));
  const closed = problems.filter(isClosed);

  return [
    ...(active.length > 0 ? [{ key: 'active' as const, data: active }] : []),
    ...(closed.length > 0 ? [{ key: 'closed' as const, data: closed }] : []),
  ];
}

/** The roles the head technician hands work to: technicians, himself among them (decision 1). */
const TECHNICIAN_ROLES: ReadonlySet<string> = new Set(['tech', 'head_tech']);

/** Whom «Назначить» offers, in the directory's order (by name). */
export function activeTechnicians(staff: readonly StaffMember[]): StaffMember[] {
  return staff.filter((person) => person.is_active && TECHNICIAN_ROLES.has(person.role));
}
