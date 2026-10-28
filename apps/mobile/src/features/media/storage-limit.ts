import { RefusalError } from '@/lib/server-error';

/** Megabytes as the company's video setting counts them: 1 000 000 bytes. */
const BYTES_PER_MB = 1_000_000;

/**
 * The largest file the project's storage takes in one upload, in megabytes.
 *
 * Supabase Free refuses anything bigger with 413, whatever the bucket's own
 * limit and the company's `video_max_mb` say (on 09.10 the company allowed 140
 * and a 105.9 MB video never got in). Counted in 10^6 bytes like the company's
 * setting: should the storage mean 50 MiB, this is 2.4 MB on the safe side.
 * The camera stops here too (`videoLimits`). Raise it with the plan.
 */
export const STORAGE_FILE_LIMIT_MB = 50;

const REFUSAL_KEY = 'video.tooLargeForStorage';

/**
 * A recording the storage would refuse, said before it is queued: the upload
 * would only fail later, after the person has left the step.
 */
export class TooLargeForStorageError extends RefusalError {
  /** The key's parameters, read like a database refusal's `details`. */
  readonly details: string;

  constructor(byteSize: number) {
    super(
      `The file is ${byteSize} bytes; the storage takes up to ${STORAGE_FILE_LIMIT_MB * BYTES_PER_MB}`,
      REFUSAL_KEY,
    );
    this.name = 'TooLargeForStorageError';
    this.details = JSON.stringify({
      size: Math.ceil(byteSize / BYTES_PER_MB),
      limit: STORAGE_FILE_LIMIT_MB,
    });
  }
}

/** Throws when a file of this size would not get into the storage. */
export function assertStorageTakes(byteSize: number): void {
  if (byteSize > STORAGE_FILE_LIMIT_MB * BYTES_PER_MB) {
    throw new TooLargeForStorageError(byteSize);
  }
}
