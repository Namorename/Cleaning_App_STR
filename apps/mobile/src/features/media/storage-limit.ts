import { RefusalError } from '@/lib/server-error';

/** Megabytes as the company's video setting counts them: 1 000 000 bytes. */
const BYTES_PER_MB = 1_000_000;

/**
 * The largest file the project's storage takes in one upload, in megabytes.
 *
 * The storage refuses anything bigger with 413, whatever the bucket's own
 * limit and the company's `video_max_mb` say (on 09.10, on Supabase Free, the
 * company allowed 140 and a 105.9 MB video never got in). 50 while the project
 * was on Free; 150 from the update after the project's global limit was raised
 * to 150 MiB on Pro — the bucket's own (docs/video-upload-1022.md): at 50, a
 * gallery video of 16 Mbit/s (seen 20–22.10) fits 25 seconds. Not to go out before
 * that setting: a file over the project's limit is refused after she has left
 * the step. Counted in 10^6 bytes like the company's setting, so 150 is 7 MB
 * under 150 MiB. The camera stops here too (`videoLimits`).
 */
export const STORAGE_FILE_LIMIT_MB = 150;

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
