/**
 * What the office adds to a task (20261126100000): photos and videos at work or with its closing,
 * a batch at a time, and the closing's comment, which lives in the task's chat. The panel and the
 * phone read it alike.
 */

/** How many files one batch takes; the server holds the same (problem_addition_max_files). */
export const ADDITION_MAX_FILES = 10;

/** problem_additions.stage: added to a task at work, or sent with its closing. */
export const ADDITION_STAGES = ['open', 'closing'] as const;
export type AdditionStage = (typeof ADDITION_STAGES)[number];

/**
 * The batches of a task with their files and the closing's comment. A batch on its way is not
 * returned at all (the table's policy shows published batches only).
 */
export const ADDITION_SELECT =
  'id, problem_id, author_id, author_name, stage, created_at, published_at, ' +
  'files:task_media(id, kind, storage_path, mime_type, duration_sec, created_at, uploaded_at, ' +
  'deleted_at, purged_at), ' +
  'message:chat_messages(id, body)';

/** A file of a batch as the apps read it. */
export interface AdditionFileRow {
  readonly uploaded_at: string | null;
  readonly deleted_at: string | null;
  readonly purged_at: string | null;
}

/**
 * A file to show: it arrived, nobody took it back, the sweep has not taken it. A published
 * batch holds only such files, but the sweep comes 90 days after the task closed.
 */
export function isShownAdditionFile(file: AdditionFileRow): boolean {
  return file.uploaded_at !== null && file.deleted_at === null && file.purged_at === null;
}
