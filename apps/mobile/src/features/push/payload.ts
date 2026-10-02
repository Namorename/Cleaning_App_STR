import { z } from 'zod';

import { CHAT_SUBJECT_KINDS } from '@/features/chat/schema';
import type { PushKind } from '@/features/settings/schema';

/** Every push about a cleaning: each names the cleaning and nothing else. */
export type TaskPushKind = Exclude<PushKind, 'chat_message' | 'daily_digest'>;

/**
 * Listed by hand rather than filtered off the enum: z.enum needs the literal
 * tuple, and a kind a migration adds must be given a destination (destination.ts)
 * before it is let through — the test holds the list to the enum.
 */
export const TASK_PUSH_KINDS = [
  'cleaning_new',
  'cleaning_assigned',
  'cleaning_unassigned',
  'cleaning_cancelled',
  'cleaning_moved',
  'cleaning_window',
  'cleaning_free',
  'booking_cancelled_live',
] as const satisfies readonly TaskPushKind[];

const taskPushSchema = z.object({
  kind: z.enum(TASK_PUSH_KINDS),
  taskId: z.string().uuid(),
});

const chatPushSchema = z.object({
  kind: z.literal('chat_message'),
  subject: z.enum(CHAT_SUBJECT_KINDS),
  id: z.string().uuid(),
  // What the phone tells the thread on screen by: a repair's chat is opened
  // from its cleaning, while the server names it after the problem.
  threadId: z.string().uuid().optional(),
});

const digestPushSchema = z.object({ kind: z.literal('daily_digest') });

const pushDataSchema = z.union([taskPushSchema, chatPushSchema, digestPushSchema]);

export type TaskPushData = z.infer<typeof taskPushSchema>;
export type ChatPushData = z.infer<typeof chatPushSchema>;
export type PushData = z.infer<typeof pushDataSchema>;

/**
 * The data of a push, as send-push writes it — or null for anything else: a
 * kind a newer server sends to an older build, or data that is not ours. A
 * push the app cannot read is still shown by the system; a tap on it only
 * opens the app.
 */
export function readPushData(data: unknown): PushData | null {
  const parsed = pushDataSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
