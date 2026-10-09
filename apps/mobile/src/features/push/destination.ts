import type { QueryKey } from '@tanstack/react-query';

import { chatKeys } from '@/features/chat/keys';
import type { ChatSubjectKind } from '@/features/chat/schema';
import { problemKeys } from '@/features/problems/keys';
import { stepKeys } from '@/features/steps/keys';
import type { CleaningTask } from '@/features/tasks/schema';

import type { PushData, TaskPushData, TaskPushKind } from './payload';

/** What her list says when a tap on a push could not open the cleaning. */
export const PUSH_NOTICES = ['unassigned', 'cancelled', 'movedAway'] as const;
export type PushNotice = (typeof PUSH_NOTICES)[number];

export type PushDestination =
  | { pathname: '/task/[id]'; params: { id: string } }
  | { pathname: '/problem/[id]'; params: { id: string } }
  | { pathname: '/chat/[subject]/[id]'; params: { subject: ChatSubjectKind; id: string } }
  | { pathname: '/(tabs)'; params?: { notice: PushNotice } };

/**
 * Where each cleaning push leads. A Record, so a kind added to the enum does
 * not compile until it is given a place.
 *
 * - `task`: the cleaning itself — hers, or free for her to take.
 * - a notice: her list, saying why the cleaning is not there. The server
 *   already hides it from her, and opening it by id would first draw the copy
 *   cached in the lists as if it still were.
 * - `moved`: it depends — a cleaning moved to another flat or day may have
 *   left her with it; asked, not guessed.
 */
const TASK_LANDING: Record<TaskPushKind, 'task' | 'moved' | PushNotice> = {
  cleaning_new: 'task',
  cleaning_assigned: 'task',
  cleaning_window: 'task',
  cleaning_free: 'task',
  booking_cancelled_live: 'task',
  cleaning_moved: 'moved',
  cleaning_unassigned: 'unassigned',
  cleaning_cancelled: 'cancelled',
};

const TASKS: QueryKey = ['tasks'];

/**
 * Where a tap on a push leads. `findTask` is asked only about a moved
 * cleaning; without signal the cleaning is opened, and its screen says what
 * it can from what the phone has.
 */
export async function destinationOf(
  data: PushData,
  findTask: (taskId: string) => Promise<CleaningTask | null>,
): Promise<PushDestination> {
  switch (data.kind) {
    case 'chat_message':
      return { pathname: '/chat/[subject]/[id]', params: { subject: data.subject, id: data.id } };
    case 'daily_digest':
      return { pathname: '/(tabs)' };
    case 'problem_new':
      // The task's own screen, where the head technician hands it out.
      return { pathname: '/problem/[id]', params: { id: data.problemId } };
    default:
      return taskDestination(data, findTask);
  }
}

async function taskDestination(
  data: TaskPushData,
  findTask: (taskId: string) => Promise<CleaningTask | null>,
): Promise<PushDestination> {
  const toTask: PushDestination = { pathname: '/task/[id]', params: { id: data.taskId } };
  const landing = TASK_LANDING[data.kind];
  if (landing === 'task') {
    return toTask;
  }
  if (landing !== 'moved') {
    return { pathname: '/(tabs)', params: { notice: landing } };
  }
  const task = await findTask(data.taskId).catch(() => undefined);
  return task === null ? { pathname: '/(tabs)', params: { notice: 'movedAway' } } : toTask;
}

/**
 * What a push makes stale on the phone: the next look at those screens asks
 * the server rather than the cache. Data that cannot be read refreshes the
 * cleanings, the one list every push may touch. A new task refreshes the
 * tasks — the head technician's board and its screens sit under them — and
 * his jobs beside them.
 */
export function staleAfter(data: PushData | null): QueryKey[] {
  if (data === null || data.kind === 'daily_digest') {
    return [TASKS];
  }
  if (data.kind === 'chat_message') {
    return data.threadId === undefined
      ? [chatKeys.unreadAll]
      : [chatKeys.unreadAll, chatKeys.messages(data.threadId)];
  }
  if (data.kind === 'problem_new') {
    return [TASKS, problemKeys.all];
  }
  return [TASKS, stepKeys.all];
}
