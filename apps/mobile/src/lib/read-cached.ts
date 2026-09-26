import type { z } from 'zod';

/** A reader's error is shown small under a sentence; a long one pushes the screen away. */
const MAX_PATH_LENGTH = 60;

/**
 * Read what the query cache holds as if it came from outside — because on a
 * phone it may have. The cache on disk is restored by JSON.parse in whatever
 * shape the build that wrote it read, and zod never sees it on the way in
 * (docs/chat-plan.md: an OTA that added `task_media` closed the app on every
 * thread cached before it). Passed to a query's `select`, the schema fills
 * what an older shape lacks; what it cannot read becomes one short line that
 * names the first thing wrong, not zod's whole report.
 */
export function readCached<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return parsed.data;
  }
  const [issue] = parsed.error.issues;
  const path = (issue?.path.join('.') ?? '?').slice(0, MAX_PATH_LENGTH);
  throw new Error(`Cached ${what} unreadable at ${path}: ${issue?.message ?? 'unknown'}`);
}
