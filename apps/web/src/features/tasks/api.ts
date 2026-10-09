import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import {
  groupByStep,
  STEP_MEDIA_COLUMNS,
  stepMediaListSchema,
  type StepMedia,
} from '@/features/media/schema';
import { cancelLiveTask } from '@/lib/cancel-live-task';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { todayIso } from '@/lib/format-date';
import { withSignedUrls, type WithUrl } from '@/lib/media';

import {
  calendarTaskListSchema,
  departureGuestSchema,
  expiredTaskListSchema,
  liveRepairListSchema,
  offStaffTaskListSchema,
  propertyListSchema,
  staffListSchema,
  taskListSchema,
  taskProblemListSchema,
  taskSchema,
  UNDER_WAY_STATUSES,
  type CalendarTask,
  type DepartureGuest,
  type ExpiredTask,
  type LiveRepair,
  type OffStaffTask,
  type Property,
  type Staff,
  type Task,
  type TaskDraft,
  type TaskProblem,
  type TaskStatus,
} from './schema';

export type Client = SupabaseClient<Database>;

/**
 * How far back the section reads.
 *
 * The closed tab is a recent history, not an archive: a manager looks at last
 * week's cleanings, and the report that answers "how much work was there in
 * June" is F12's, with its own query. Without a bound this list grows for as
 * long as the company exists and is fetched whole on every visit.
 */
export const HISTORY_DAYS = 30;

const TASK_COLUMNS =
  'id, property_id, reservation_id, problem_id, type, status, priority, assignee_id, ' +
  'created_by, scheduled_date, time_from, time_to, started_at, completed_at, ' +
  'measured_minutes, duration_override_min, is_parallel, is_short_measurement, ' +
  'notes, title, title_i18n, created_at, ' +
  // The booking's dates when the manager moved its cleaning, null unless moved
  // (20260926160000): the calendar judges a moved cleaning's booking by them.
  'pinned_arrival, pinned_departure, ' +
  // The room a cleaning stands on is named "1 - 2109" and names no building,
  // so the building comes along: `taskPropertyName` composes the two, the card
  // shows it and the search looks through it. The hint is the foreign key
  // COLUMN — `properties!parent_id` walks the relation backwards and answers
  // with an empty array, and the constraint name is not in the schema cache.
  // The zone comes along so "yesterday" on a card is the property's
  // yesterday, as the grace rule counts it (`tailOf`).
  'property:properties(name, hostaway_unit_id, timezone, parent:parent_id(name)), ' +
  'assignee:profiles!tasks_assignee_id_fkey(full_name, role), ' +
  'author:profiles!tasks_created_by_fkey(full_name, role)';

/** A calendar day `days` before today, as `YYYY-MM-DD`. */
function daysAgo(days: number, now: Date = new Date()): string {
  const past = new Date(now);
  past.setDate(past.getDate() - days);
  return todayIso(past);
}

/**
 * The company's schedule from HISTORY_DAYS ago onward. Row level security
 * draws the line.
 *
 * Read page by page: one response stops at the server's max-rows, and a month
 * back is thousands of rows (most of them expired duplicates until the
 * pre-launch reset), so a single request ended weeks before today. The sort
 * ends on `id` because pages only tile a list whose order has no ties.
 */
export async function fetchTasks(client: Client): Promise<Task[]> {
  const since = daysAgo(HISTORY_DAYS);
  const rows = await fetchAllPages((from, to, withCount) =>
    client
      .from('tasks')
      .select(TASK_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .gte('scheduled_date', since)
      .order('scheduled_date', { ascending: true })
      .order('time_from', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return taskListSchema.parse(rows);
}

/**
 * The calendar's classes of tasks (docs/f10-plan.md, §1, §2). The live and
 * the done are its default view; the cancelled sit behind their own switch
 * (7.5). Expired has a reader of its own: it is never saved from the panel,
 * and under `tasks` every save would reread thousands of its rows.
 */
/** The statuses of a task somebody may still do. */
export const LIVE_STATUSES = [
  'unassigned',
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'blocked',
] as const satisfies readonly TaskStatus[];

export const TASK_CLASSES = {
  active: [...LIVE_STATUSES, 'done'],
  cancelled: ['cancelled'],
} as const satisfies Record<string, readonly TaskStatus[]>;
export type TaskClass = keyof typeof TASK_CLASSES;

// A repair names its problem on the chip, with the problem's priority (§6).
const CALENDAR_TASK_COLUMNS = `${TASK_COLUMNS}, problem:problem_id(title, priority)`;

/**
 * One class of tasks on the days `from` up to `to` (exclusive), for the
 * calendar. Read in pages, sorted to the id last.
 */
export async function fetchTasksBetween(
  client: Client,
  from: string,
  to: string,
  taskClass: TaskClass,
): Promise<CalendarTask[]> {
  const rows = await fetchAllPages((first, last, withCount) =>
    client
      .from('tasks')
      .select(CALENDAR_TASK_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .gte('scheduled_date', from)
      .lt('scheduled_date', to)
      .in('status', [...TASK_CLASSES[taskClass]])
      .order('scheduled_date', { ascending: true })
      .order('time_from', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(first, last),
  );
  return calendarTaskListSchema.parse(rows);
}

// A mark needs no more: until the pre-launch reset there are thousands (§1).
// The assignee's name comes along: a cleaner who has left is in no other list
// the calendar reads, and her missed cleanings are the ones a mark is for.
const EXPIRED_COLUMNS =
  'id, property_id, reservation_id, scheduled_date, type, assignee_id, ' +
  'assignee:profiles!tasks_assignee_id_fkey(full_name)';

/**
 * The tasks that never happened on the days `from` up to `to` (exclusive):
 * the calendar's «Не состоялась» (§2). Read in pages, sorted to the id last.
 */
export async function fetchExpiredBetween(
  client: Client,
  from: string,
  to: string,
): Promise<ExpiredTask[]> {
  const rows = await fetchAllPages((first, last, withCount) =>
    client
      .from('tasks')
      .select(EXPIRED_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .eq('status', 'expired')
      .gte('scheduled_date', from)
      .lt('scheduled_date', to)
      .order('scheduled_date', { ascending: true })
      .order('id', { ascending: true })
      .range(first, last),
  );
  return expiredTaskListSchema.parse(rows);
}

/** One task whole, for the drawer a closed chip opens. Null when there is no row to see. */
export async function fetchTask(client: Client, taskId: string): Promise<Task | null> {
  const { data, error } = await client
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('id', taskId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? null : taskSchema.parse(data);
}

// The technician with the switch that says whether they still work here, and
// the listing joined inner so an archived one's repair falls away (§6). The
// dashboard names the place, and a room's own name never says which building
// it is in: the room test and the building come along (propertyPathOf).
const REPAIR_COLUMNS =
  'id, property_id, problem_id, status, scheduled_date, assignee_id, ' +
  'assignee:profiles!tasks_assignee_id_fkey(full_name, is_active), ' +
  'property:properties!inner(name, status, timezone, hostaway_unit_id, parent:parent_id(name))';

/**
 * Every live repair, whatever its day (§6): the sweep no longer closes a
 * repair, so one left behind stays live until somebody closes it. A handful
 * at a time — no pages. The calendar's badge and stage 8's counters read it.
 */
export async function fetchLiveRepairs(client: Client): Promise<LiveRepair[]> {
  const { data, error } = await client
    .from('tasks')
    .select(REPAIR_COLUMNS)
    .not('problem_id', 'is', null)
    .in('status', [...LIVE_STATUSES])
    .neq('property.status', 'archived')
    .order('scheduled_date', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return liveRepairListSchema.parse(data ?? []);
}

// The person joined inner: the filter on her switch drops the job, not just
// her name. The listing as the live repairs read it, the archive left out.
const OFF_STAFF_COLUMNS =
  'id, property_id, type, status, scheduled_date, assignee_id, ' +
  'assignee:profiles!tasks_assignee_id_fkey!inner(full_name, is_active), ' +
  'property:properties!inner(name, status, timezone, hostaway_unit_id, parent:parent_id(name))';

/**
 * The work under way on people switched off (docs/staff-disable-plan.md):
 * switching an account off takes it off everything nobody has started
 * (20261004100000), and what it had started waits for the manager. Every job
 * but a repair of a task — those are the repair tiles' (fetchLiveRepairs).
 * A handful at a time, whatever the day — no pages.
 */
export async function fetchOffStaffWork(client: Client): Promise<OffStaffTask[]> {
  const { data, error } = await client
    .from('tasks')
    .select(OFF_STAFF_COLUMNS)
    .is('problem_id', null)
    .in('status', [...UNDER_WAY_STATUSES])
    .eq('assignee.is_active', false)
    .neq('property.status', 'archived')
    .order('scheduled_date', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return offStaffTaskListSchema.parse(data ?? []);
}

/** Active people of the company a task can be handed to. */
export async function fetchStaff(client: Client): Promise<Staff[]> {
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, role')
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) {
    throw error;
  }
  return staffListSchema.parse(data ?? []);
}

/**
 * Listings a task can be put on, and the rooms of the ones that have rooms.
 *
 * Archived ones are out — that listing has left the company. A flat under
 * maintenance stays on offer: booking a technician onto it is the reason the
 * state exists.
 *
 * Rooms are in, and have to be: a generated cleaning stands on the room the
 * guest slept in, so a field that cannot name one has nothing to show where
 * the flat belongs. `parent_id` comes along because a room's own name never
 * says which building it is in — `propertyOptions` puts the two together.
 *
 * The archived test stays on `status`, and the room test on
 * `hostaway_unit_id` rather than `parent_id`: that column carries two
 * different relationships — a room of a multi-unit listing, and a part of a
 * combined listing, which is a real listing with its own calendar.
 */
export async function fetchProperties(client: Client): Promise<Property[]> {
  const { data, error } = await client
    .from('properties')
    .select('id, name, parent_id, hostaway_unit_id, status, timezone')
    .neq('status', 'archived')
    .order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return propertyListSchema.parse(data ?? []);
}

export interface TaskStep {
  id: string;
  sort_order: number;
  type: string;
  required: boolean;
  title: string | null;
  title_i18n: Record<string, string> | null;
  completed_at: string | null;
  skipped_at: string | null;
  waived_at: string | null;
}

export interface TaskWork {
  steps: TaskStep[];
  /** The photos and videos taken on the task, keyed by the step they belong to. */
  mediaByStep: Record<string, WithUrl<StepMedia>[]>;
}

/** What the cleaner actually did: the steps she was given, and what she photographed or filmed. */
export async function fetchTaskWork(client: Client, taskId: string): Promise<TaskWork> {
  const [stepsResult, mediaResult] = await Promise.all([
    client
      .from('task_steps')
      .select(
        'id, sort_order, type, required, title, title_i18n, completed_at, skipped_at, waived_at',
      )
      .eq('task_id', taskId)
      .order('sort_order', { ascending: true }),
    client
      .from('task_media')
      .select(STEP_MEDIA_COLUMNS)
      .eq('task_id', taskId)
      .is('deleted_at', null)
      .is('purged_at', null)
      .not('uploaded_at', 'is', null)
      .order('created_at', { ascending: true }),
  ]);
  if (stepsResult.error) {
    throw stepsResult.error;
  }
  if (mediaResult.error) {
    throw mediaResult.error;
  }

  const media = await withSignedUrls(client, stepMediaListSchema.parse(mediaResult.data ?? []));
  return { steps: (stepsResult.data ?? []) as TaskStep[], mediaByStep: groupByStep(media) };
}

/**
 * The booking a generated cleaning closes, for its form: the Hostaway id and
 * the guest who is leaving. Read one booking when the form opens rather than
 * joined onto the list, which would carry every guest's name on every visit.
 * Managers only by row level security; null when the booking is gone.
 */
export async function fetchReservationGuest(
  client: Client,
  reservationId: number,
): Promise<DepartureGuest | null> {
  const { data, error } = await client
    .from('reservations')
    .select('id, guest_name')
    .eq('id', reservationId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? null : departureGuestSchema.parse(data);
}

/** Problems the cleaner reported while doing this task. */
export async function fetchTaskProblems(client: Client, taskId: string): Promise<TaskProblem[]> {
  const { data, error } = await client
    .from('problems')
    .select('id, title, status, created_at')
    .eq('task_id', taskId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) {
    throw error;
  }
  return taskProblemListSchema.parse(data ?? []);
}

export interface SaveTaskVariables {
  draft: TaskDraft;
  /** The manager saw "such a task already exists" and said to put it there anyway. */
  allowDuplicate?: boolean;
}

/**
 * Write a task, or rewrite one. The id comes from the panel, so a retry replays.
 *
 * `p_title_i18n` is deliberately not sent: the form has one title field, and
 * omitting the argument tells the server to leave whatever translations the
 * row carries alone rather than emptying them.
 *
 * `p_expected_date` is the day the form was opened with, on the first save and
 * on the «save it anyway» retry alike; a new task sends none. Sending it is
 * also what makes a move of a booking's cleaning hold (20260926160000).
 */
export async function saveTask(client: Client, variables: SaveTaskVariables): Promise<Task> {
  const { draft } = variables;
  const { data, error } = await client.rpc('save_task', {
    p_id: draft.id,
    p_property_id: draft.propertyId ?? 0,
    p_type: draft.type,
    p_scheduled_date: draft.scheduledDate,
    p_title: draft.title.trim() === '' ? undefined : draft.title.trim(),
    p_assignee_id: draft.assigneeId ?? undefined,
    p_time_from: draft.timeFrom ?? undefined,
    p_time_to: draft.timeTo ?? undefined,
    p_notes: draft.notes.trim() === '' ? undefined : draft.notes.trim(),
    p_allow_duplicate: variables.allowDuplicate ?? false,
    p_expected_date: draft.expectedDate ?? undefined,
  });
  if (error) {
    throw error;
  }
  return taskSchema.parse(data);
}

/**
 * Call the job off. Nothing is deleted — a cancelled task stays as history,
 * and its day is free for something else. Only a live task is touched; see
 * cancelLiveTask.
 */
export async function cancelTask(client: Client, taskId: string): Promise<void> {
  await cancelLiveTask(client, taskId);
}

/**
 * Correct how long a finished cleaning is counted as.
 *
 * The measurement itself is never rewritten (§13.3): the correction goes into
 * its own column, and null takes it back to what the clock recorded.
 */
export async function setDurationOverride(
  client: Client,
  taskId: string,
  minutes: number | null,
): Promise<void> {
  const { error } = await client
    .from('tasks')
    .update({ duration_override_min: minutes })
    .eq('id', taskId);
  if (error) {
    throw error;
  }
}
