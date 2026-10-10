import { Constants, type TaskStatus, type TaskType } from '@str-ops/shared';

import { RefusalError } from '@/lib/server-error';
import { supabase } from '@/lib/supabase';

import { DONE_PAGE_SIZE } from './done';
import { cleaningTaskListSchema, earliestClaimableDate, type CleaningTask } from './schema';

// The joined listing name is what the cleaner actually recognises; the numeric
// id means nothing to her. Notes ride along: the code for the key box is the
// first thing she needs at the door.
//
// `effective_cleaner_notes` is NOT a column. It is a function of the row
// (`20260917150000_room_cleaner_notes.sql`) that PostgREST serves as one, and
// it answers with the listing's note when the row is a room carrying none of
// its own — which, since cleanings moved onto rooms, is where the note is
// actually written. Asking for the raw `cleaner_notes` here is what made "the
// key is in box 4325" invisible to the person standing at that box.
//
// Type generation models it as a function rather than a column, so `tsc` does
// not vouch for the spelling and — as the ambiguous embed below taught us — a
// bad select in this codebase fails silently into zod. Verified against a
// running PostgREST instead: a room with a blank note answers with its
// listing's, and a misspelled field answers 42703.
//
// Since the cleanings moved onto rooms, the joined name of a multi-unit
// listing's cleaning is the room's — "1 - 2109" — which names no house. The
// house is the parent row and the street is `address`, so both are asked for
// here rather than left to a second query the phone would make offline.
//
// `parent:parent_id(...)` names the FOREIGN KEY COLUMN, and that is what makes
// it resolve forward to one row. The two other spellings do not work:
// `properties!parent_id` walks the relation backwards and returns `[]`, and
// the constraint name `properties_parent_id_fkey` is not in the schema cache
// as a hint at all. Verified against the hosted project on 2026-09-14.
//
// `problem:problem_id(...)` is hinted for a different reason: tasks and
// problems are joined TWICE — `tasks.problem_id` is the report a maintenance
// task fixes, `problems.task_id` is the cleaning a problem was found during.
// Asked by table name, the server cannot tell which one is meant and refuses
// the whole query with "Could not embed because more than one relationship was
// found", leaving the cleaner with an empty screen. The same pair is hinted
// from the other side in `features/problems/api.ts`.
//
// `reservation_id` is asked for only to tell a job that follows a booking from
// one made by hand: the second has no check-in to speak of (`urgencyText`).
const TASK_COLUMNS =
  'id, type, status, priority, scheduled_date, due_at, assignee_id, property_id, reservation_id, ' +
  'time_from, time_to, guests_count, started_at, completed_at, is_parallel, ' +
  'notes, title, title_i18n, ' +
  'property:properties(name, address, hostaway_unit_id, effective_cleaner_notes, parent:parent_id(name)), ' +
  'problem:problem_id(id, title, priority)';

// Whatever the office assigned to her is hers to see: a technician's
// maintenance, a cleaner's cleaning, and the inspections and mid-stay
// cleanings the panel creates. A kind left out here never reached her, and the
// nightly sweep closed it as expired.
const MY_TASK_TYPES = Constants.public.Enums.task_type;

// What anyone may take for herself. A mid-stay cleaning is a cleaning; an
// inspection is given by the office, never picked from the pool (owner's
// decision, 2026-09-24).
const FREE_TASK_TYPES = ['cleaning', 'midstay'] as const satisfies readonly TaskType[];

// `satisfies` ties the list to the database enum: a status renamed in a
// migration becomes a type error here instead of a filter that silently
// matches nothing.
const OPEN_STATUSES = [
  'unassigned',
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'blocked',
] as const satisfies readonly TaskStatus[];

/**
 * Tasks already belonging to this cleaner.
 *
 * Row level security would hide other people's work anyway; filtering by
 * assignee here is what separates "mine" from the queue, not a security
 * measure.
 */
export async function fetchMyTasks(cleanerId: string): Promise<CleaningTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .in('type', MY_TASK_TYPES)
    .eq('assignee_id', cleanerId)
    .in('status', OPEN_STATUSES)
    .order('scheduled_date', { ascending: true })
    .order('priority', { ascending: false });

  if (error) {
    throw error;
  }

  return cleaningTaskListSchema.parse(data ?? []);
}

/**
 * One page of «Выполненные»: her own finished jobs since `since`, newest
 * first; `page` counts from 0. Ordered to the id as well, so a page boundary
 * never repeats or skips a job finished in the same instant as another.
 *
 * Her own by the assignee, not by the listing: the row policies also show her
 * a colleague's finished cleaning on a listing she cleans, and that is not
 * her history. A finish stamped by nobody (a service write, no
 * `completed_at`) has no day to fall in the window and is left out.
 */
export async function fetchMyDoneTasks(
  cleanerId: string,
  page: number,
  since: string,
): Promise<CleaningTask[]> {
  const first = page * DONE_PAGE_SIZE;
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .in('type', MY_TASK_TYPES)
    .eq('assignee_id', cleanerId)
    .eq('status', 'done')
    .gte('completed_at', since)
    .order('completed_at', { ascending: false })
    .order('id', { ascending: false })
    .range(first, first + DONE_PAGE_SIZE - 1);

  if (error) {
    throw error;
  }

  return cleaningTaskListSchema.parse(data ?? []);
}

/**
 * Free tasks on the listings this cleaner is linked to.
 *
 * The link itself is enforced by row level security: an unassigned task on a
 * listing she does not clean is simply not in the result.
 *
 * The date filter is courtesy, not enforcement. Work past its grace period is
 * refused by the server whatever this query asks for; the nightly sweep closes
 * it as 'expired' a few hours later. Between the two, this keeps the queue
 * from offering a card that cannot be taken.
 *
 * There is deliberately no filter for the far end. The seven-day horizon lives
 * in the row policies, so tasks beyond it never reach the client at all —
 * mirroring the number here would only create something to drift.
 */
export async function fetchFreeTasks(): Promise<CleaningTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .in('type', FREE_TASK_TYPES)
    .eq('status', 'unassigned')
    .is('assignee_id', null)
    .gte('scheduled_date', earliestClaimableDate())
    .order('scheduled_date', { ascending: true })
    .order('priority', { ascending: false });

  if (error) {
    throw error;
  }

  return cleaningTaskListSchema.parse(data ?? []);
}

/** One task, for its own screen. Null when it is not hers to see any more. */
export async function fetchTask(taskId: string): Promise<CleaningTask | null> {
  const { data, error } = await supabase.from('tasks').select(TASK_COLUMNS).eq('id', taskId);

  if (error) {
    throw error;
  }

  const rows = cleaningTaskListSchema.parse(data ?? []);
  return rows[0] ?? null;
}

interface MovePatch {
  status: TaskStatus;
  assignee_id?: string;
}

interface SameJob {
  scheduledDate: string;
  propertyId: number;
}

/**
 * One move of a task: the statuses it moves from, what it writes, the key of
 * its refusal, and — for an accept — the day and the flat she saw.
 */
interface Move {
  from: readonly TaskStatus[];
  patch: MovePatch;
  failureKey: string;
  same?: SameJob;
  /**
   * Her row as read back after the move matched none: the row when the move
   * is done already, null when the move's own refusal stands. May raise a
   * refusal of its own, with its own sentence.
   */
  landed: (row: CleaningTask) => CleaningTask | null;
}

/** A job still to be done; a take that landed leaves it at one of these, whatever the office did since. */
function isOpen(status: TaskStatus): boolean {
  return (OPEN_STATUSES as readonly TaskStatus[]).includes(status);
}

/** Where a job is once its work has begun: past a take and past an accept. */
const WORK_BEGUN = ['in_progress', 'done'] as const satisfies readonly TaskStatus[];

function isWorkBegun(status: TaskStatus): boolean {
  return (WORK_BEGUN as readonly TaskStatus[]).includes(status);
}

/**
 * The sentence for her own job found cancelled: the one the task screen's
 * notice shows when it is (`tasks.pushNotice`), in a technician's words too.
 * A replayed take or accept that finds it so is told exactly that, never
 * «already taken» (LOW-6 of the review of dab5237..cb747a5).
 */
const CANCELLED_KEY = 'tasks.pushNotice.cancelled';

function refuseCancelled(row: CleaningTask): never {
  throw new RefusalError(`Task ${row.id} is cancelled`, CANCELLED_KEY);
}

/** A start or a finish is done when the row is at the status it moves to. */
function atStatus(status: TaskStatus): Move['landed'] {
  return (row) => (row.status === status ? row : null);
}

/** Who the phone's session says is signed in; null for nobody. */
async function signedInId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session?.user.id ?? null;
}

/**
 * The row, when the move it was to make is already made: held by whoever
 * made it — the one it hands the task to, or the one signed in — and as the
 * move's own `landed` reads it. Null when it is not, or the row is out of her
 * sight.
 *
 * A move replayed from the queue after its answer was lost without signal
 * finds no row at the status it moves from — its first try moved it — and
 * that is not «taken by somebody else» or «could not finish» (the
 * verification review of c466bf5..bc7dcc9, item 6). The row is read through
 * the same select as the task's own screen; a colleague's row on one of her
 * listings is visible to her too, hence the holder.
 *
 * A failure of the read is thrown as it came, the server's own shape and all:
 * the screens put every move's failure through `serverErrorText`, and one
 * that is the network's pauses the move until there is signal
 * (lib/move-retry.ts) instead of refusing it.
 */
async function alreadyMoved(taskId: string, move: Move): Promise<CleaningTask | null> {
  const row = await fetchTask(taskId);
  if (row === null) {
    return null;
  }
  const mover = move.patch.assignee_id ?? (await signedInId());
  return mover !== null && row.assignee_id === mover ? move.landed(row) : null;
}

/**
 * Move a task from one status to the next.
 *
 * The `status` filter on the update is what makes every move safe against a
 * stale screen and against two taps: an update that no longer matches the
 * expected status touches no row, and the caller is told rather than left to
 * believe it worked — unless the row is already where the move takes it, and
 * hers (`alreadyMoved`): then the move is done. The server refuses moves it
 * disallows — a second start with parallel work switched off, a finish
 * without a start — with an error that arrives as `error`, and stamps the
 * clock itself: nothing about the time is sent from here.
 *
 * The no-row answer is raised in the server's shape — English for the logs,
 * the reader's sentence by its key — so a screen translates it through
 * `serverErrorText` like any refusal and never shows the log line.
 */
async function moveTask(taskId: string, move: Move): Promise<CleaningTask> {
  const { from, patch, failureKey, same } = move;
  const moving = supabase.from('tasks').update(patch).eq('id', taskId).in('status', from);
  const narrowed =
    same === undefined
      ? moving
      : moving.eq('scheduled_date', same.scheduledDate).eq('property_id', same.propertyId);
  const { data, error } = await narrowed.select(TASK_COLUMNS);

  if (error) {
    throw error;
  }

  const moved = cleaningTaskListSchema.parse(data ?? []);
  if (moved.length > 0) {
    return moved[0];
  }

  const landed = await alreadyMoved(taskId, move);
  if (landed !== null) {
    return landed;
  }
  throw new RefusalError(
    `Moving task ${taskId} from '${from.join("' or '")}' to '${patch.status}' matched no row`,
    failureKey,
  );
}

/**
 * Take a free task.
 *
 * Taken is accepted: she chose it herself, and the office's "not accepted"
 * should not list it (owner's decision 5c, F11). The server lets it through
 * only since 20260928110000: the transition guard allows unassigned ->
 * accepted. Against a database without that migration the guard refuses every
 * take and every accept from this build (serverErrors.transitionNotAllowed),
 * which is why this code reaches phones only after the db push.
 *
 * Zero rows has two causes and the response cannot tell them apart: a
 * colleague was faster, or the task is past the day it could be done and the
 * server refused it. The message covers both rather than guessing — once the
 * row read back is not hers (`alreadyMoved`). Hers at any status of a job
 * still to be done, the take landed: replayed after its answer was lost, it
 * finds the job where the office has put it since — back to 'assigned', on
 * another day or in another flat — or the office gave it to her before the
 * take arrived. Either way it is hers, and «already taken» would be a lie
 * (night journal, review of bc7dcc9..dab5237). So it would be for her job
 * started or done since — the take landed too — and for one cancelled since,
 * which she is told was cancelled (LOW-6 of the review of dab5237..cb747a5).
 */
export function claimTask(taskId: string, cleanerId: string): Promise<CleaningTask> {
  return moveTask(taskId, {
    from: ['unassigned'],
    patch: { assignee_id: cleanerId, status: 'accepted' },
    failureKey: 'tasks.claimTaken',
    landed: (row) => {
      if (row.status === 'cancelled') {
        refuseCancelled(row);
      }
      return isOpen(row.status) || isWorkBegun(row.status) ? row : null;
    },
  });
}

/**
 * What she accepts: the cleaning, on the day and in the flat she saw it.
 *
 * Saved to disk with a paused accept, so the shape is kept as it is once
 * released: a queued accept from an older build replays through the same
 * function.
 */
export interface AcceptVariables {
  taskId: string;
  scheduledDate: string;
  propertyId: number;
}

/**
 * Her accept, read back after it matched no row (`alreadyMoved`).
 *
 * Accepted on the day and in the flat she saw: done. Still hers and still to
 * be done, but on another day or in another flat: the job was moved, and she
 * is told exactly that (`tasks.acceptMoved`) — not «given to someone else or
 * cancelled». The row cannot say which came first, her accept or the move,
 * and the sentence claims neither: her accept landed and the move reset it,
 * or the move came first and her accept never landed — in both the job is now
 * somewhere she has not accepted, and waits for her accept there. A success
 * was the other choice, and a quiet one: the card would slip to its new day
 * without a word, and an accept the server never took (the move first) would
 * resolve as if it had. Neither needs the server; this one is true in both
 * orders.
 *
 * Her job started or done since, wherever it stands now: there is nothing
 * left to accept, and the accept counts as landed. Cancelled since: she is
 * told it was cancelled (LOW-6 of the review of dab5237..cb747a5).
 */
function acceptLanded(same: SameJob): Move['landed'] {
  return (row) => {
    if (row.status === 'cancelled') {
      refuseCancelled(row);
    }
    if (isWorkBegun(row.status)) {
      return row;
    }
    if (!isOpen(row.status)) {
      return null;
    }
    if (row.scheduled_date !== same.scheduledDate || row.property_id !== same.propertyId) {
      throw new RefusalError(
        `Task ${row.id} moved to ${row.scheduled_date} at ${row.property_id}; ` +
          `the accept was for ${same.scheduledDate} at ${same.propertyId}`,
        'tasks.acceptMoved',
      );
    }
    return row.status === 'accepted' ? row : null;
  };
}

/**
 * Tell the office she will do it.
 *
 * A signal, not a lock: nothing waits for it, and the start does not require
 * it. 'accepted' is among the statuses it moves from, so a replay after an
 * answer lost without signal matches its own row rather than refusing — the
 * server lets a status stay what it is.
 *
 * "Accepted" means this person, this day, this flat (20260928110000): the
 * office moving the job puts it back to 'assigned'. So the day and the flat
 * she saw are part of the match. An accept tapped on a card that has not
 * caught up with a move, or replayed from the queue after one, finds no row
 * instead of accepting a day she never saw — and she is told it was moved
 * (`acceptLanded`).
 *
 * Zero rows otherwise: given to someone else, cancelled, or carried out of the
 * week she sees.
 */
export function acceptTask({
  taskId,
  scheduledDate,
  propertyId,
}: AcceptVariables): Promise<CleaningTask> {
  const same = { scheduledDate, propertyId };
  return moveTask(taskId, {
    from: ['assigned', 'accepted'],
    patch: { status: 'accepted' },
    failureKey: 'tasks.acceptFailed',
    same,
    landed: acceptLanded(same),
  });
}

/** Accepted or not: a cleaner who forgot to accept can still work at the door. */
export function startTask(taskId: string): Promise<CleaningTask> {
  return moveTask(taskId, {
    from: ['assigned', 'accepted'],
    patch: { status: 'in_progress' },
    failureKey: 'tasks.startFailed',
    landed: atStatus('in_progress'),
  });
}

export function finishTask(taskId: string): Promise<CleaningTask> {
  return moveTask(taskId, {
    from: ['in_progress'],
    patch: { status: 'done' },
    failureKey: 'tasks.finishFailed',
    landed: atStatus('done'),
  });
}
