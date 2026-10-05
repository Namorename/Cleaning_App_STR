import { z } from 'zod';

import { EMPTY_FILTERS, TASK_TABS, TASK_TYPES, type TaskFilters, type TaskTab } from './schema';

/**
 * What «Уборки» keep in their address (5.4, variant A): the tab and the
 * filters. A link, a bookmark, the sign-in page and «Назад» open the screen
 * as it was left.
 */
export interface TasksAddress {
  tab: TaskTab;
  filters: TaskFilters;
}

export const DEFAULT_TASKS_ADDRESS: TasksAddress = { tab: 'today', filters: EMPTY_FILTERS };

/** The names in the query, short because a manager may read and forward the link. */
const PARAM = {
  tab: 'tab',
  query: 'q',
  assignee: 'assignee',
  type: 'type',
  dateFrom: 'from',
  dateTo: 'to',
} as const;

const tabSchema = z.enum(TASK_TABS);
const typeSchema = z.enum(TASK_TYPES);
/** A person's id, or the queue of work nobody holds. */
const assigneeSchema = z.union([z.literal('nobody'), z.uuid()]);
const daySchema = z.iso.date();

/**
 * The address as the screen's state. Each value is checked on its own: an
 * old or hand-edited link loses the part that makes no sense and keeps the
 * rest, rather than failing the screen.
 */
export function readTasksAddress(params: URLSearchParams): TasksAddress {
  const valid = <T>(schema: z.ZodType<T>, name: string, fallback: T): T => {
    const parsed = schema.safeParse(params.get(name));
    return parsed.success ? parsed.data : fallback;
  };
  return {
    tab: valid(tabSchema, PARAM.tab, DEFAULT_TASKS_ADDRESS.tab),
    filters: {
      query: params.get(PARAM.query) ?? EMPTY_FILTERS.query,
      assigneeId: valid(assigneeSchema, PARAM.assignee, EMPTY_FILTERS.assigneeId),
      type: valid(typeSchema, PARAM.type, EMPTY_FILTERS.type),
      dateFrom: valid(daySchema, PARAM.dateFrom, EMPTY_FILTERS.dateFrom),
      dateTo: valid(daySchema, PARAM.dateTo, EMPTY_FILTERS.dateTo),
    },
  };
}

/** The query for the state, without its `?`: only what differs from the defaults. */
export function writeTasksAddress({ tab, filters }: TasksAddress): string {
  const entries: [string, string][] = [
    [PARAM.tab, tab === DEFAULT_TASKS_ADDRESS.tab ? '' : tab],
    [PARAM.query, filters.query.trim() === '' ? '' : filters.query],
    [PARAM.assignee, filters.assigneeId === EMPTY_FILTERS.assigneeId ? '' : filters.assigneeId],
    [PARAM.type, filters.type === EMPTY_FILTERS.type ? '' : filters.type],
    [PARAM.dateFrom, filters.dateFrom],
    [PARAM.dateTo, filters.dateTo],
  ];
  return new URLSearchParams(entries.filter(([, value]) => value !== '')).toString();
}
