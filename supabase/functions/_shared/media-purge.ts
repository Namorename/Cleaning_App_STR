/**
 * Retention of task media: which files to remove and how to account for it.
 *
 * Pure: the Storage client and the database are handed in, so the rules can
 * be tested without either. What is due is decided by the database
 * (`task_media_to_purge`); this module only drives the removal and reports
 * honestly what happened to each row.
 */

export interface PurgeRow {
  readonly id: string;
  readonly storage_path: string;
}

export interface StorageRemover {
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

export interface PurgeOutcome {
  /** Rows whose files are gone (or were never there) and may be marked. */
  readonly purgedIds: string[];
  /** Chunks Storage refused, with its reason — these rows stay for the next run. */
  readonly failures: string[];
}

/** Storage takes a list of paths per call; keep the calls a sensible size. */
export const REMOVE_CHUNK = 100;

export function chunk<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    chunks.push(rows.slice(start, start + size));
  }
  return chunks;
}

/**
 * Remove the files of these rows, chunk by chunk.
 *
 * Storage does not complain about a path that is not there — a file that
 * never finished uploading, or one removed by an earlier run that died
 * before marking — so a successful call means every row of the chunk is
 * settled. A refused call settles none of them: they come back next time.
 */
export async function purgeFiles(
  rows: readonly PurgeRow[],
  storage: StorageRemover,
  chunkSize: number = REMOVE_CHUNK,
): Promise<PurgeOutcome> {
  const purgedIds: string[] = [];
  const failures: string[] = [];

  for (const part of chunk(rows, chunkSize)) {
    const { error } = await storage.remove(part.map((row) => row.storage_path));
    if (error === null) {
      purgedIds.push(...part.map((row) => row.id));
    } else {
      failures.push(`${part.length} files: ${error.message}`);
    }
  }

  return { purgedIds, failures };
}
