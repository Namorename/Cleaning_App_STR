/** Query keys for everything the tasks section reads. */
export const taskKeys = {
  all: ['tasks'] as const,
  list: () => ['tasks', 'list'] as const,
  steps: (taskId: string) => ['tasks', 'steps', taskId] as const,
  problems: (taskId: string) => ['tasks', 'problems', taskId] as const,
  reservation: (reservationId: number) => ['tasks', 'reservation', reservationId] as const,
  staff: () => ['tasks', 'staff'] as const,
  properties: () => ['tasks', 'properties'] as const,
  /** One class of the calendar's tasks in one month, `YYYY-MM`. */
  calendar: (taskClass: string, month: string) => ['tasks', 'calendar', taskClass, month] as const,
  /** One task whole, for the drawer a closed chip opens. */
  one: (taskId: string) => ['tasks', 'one', taskId] as const,
  /** The live repairs whatever their day: the calendar's badge, stage 8's counters. */
  liveRepairs: () => ['tasks', 'liveRepairs'] as const,
  /** The live and done tasks of the dashboard's days, `from` up to `to` (exclusive). */
  dashboard: (from: string, to: string) => ['tasks', 'dashboard', from, to] as const,
};
