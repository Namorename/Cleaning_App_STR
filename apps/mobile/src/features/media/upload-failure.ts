import { isNetworkError } from '@/lib/network-error';
import { RefusalError } from '@/lib/server-error';

import { UploadTooSlowError } from './attach-retry';
import { TusFileError, TusRefusedError, TusRetryableError } from './tus';

/** The words under a tile that did not get in: `steps.uploadReason.<key>`. */
export type UploadFailureKey =
  | 'tooLarge'
  | 'refused'
  | 'server'
  | 'noNetwork'
  | 'timedOut'
  | 'busy'
  | 'lostPlace'
  | 'tooSlow'
  | 'fileUnreadable'
  | 'interrupted'
  | 'other';

/**
 * Why a file did not get in, in a few words for its tile: the code the
 * storage answered with where it gave one, or the kind of failure. Never the
 * failure's own message — that is the step's banner's to show, small and in
 * English (CLAUDE.md, «Текст для пользователя не хранится на сервере»).
 */
export interface UploadFailure {
  key: UploadFailureKey;
  /** The storage's status, for `refused` and `busy`. */
  status?: number;
  /** The failure's kind (its class name, or `typeof`), for `other`. */
  type?: string;
}

const PAYLOAD_TOO_LARGE = 413;

/** A status a storage error carries as a string (supabase-js `StorageApiError.statusCode`). */
function storageStatus(error: object): number | null {
  const { statusCode } = error as { statusCode?: unknown };
  const status = typeof statusCode === 'string' ? Number(statusCode) : statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status > 0 ? status : null;
}

function fromStatus(status: number): UploadFailure {
  return status === PAYLOAD_TOO_LARGE ? { key: 'tooLarge' } : { key: 'refused', status };
}

function fromRetryable(error: TusRetryableError): UploadFailure {
  switch (error.reason) {
    case 'no-answer':
      return { key: 'noNetwork' };
    case 'timed-out':
      return { key: 'timedOut' };
    case 'busy':
      return error.status === undefined ? { key: 'busy' } : { key: 'busy', status: error.status };
    case 'lost-place':
      return { key: 'lostPlace' };
    case 'stalled':
      return { key: 'tooSlow' };
  }
}

/** A database's answer: PostgREST's error object, with its SQLSTATE in `code`. */
function isDatabaseAnswer(error: object): boolean {
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && code !== '';
}

/**
 * The failure of a file's last attempt, as its tile names it — or, when no
 * attempt is known (the app was closed while the file was on its way, and
 * its row waits without the file), that the upload was interrupted.
 */
export function uploadFailureOf(error: unknown): UploadFailure {
  if (error === undefined || error === null) {
    return { key: 'interrupted' };
  }
  if (typeof error !== 'object') {
    return { key: 'other', type: typeof error };
  }
  if (error instanceof UploadTooSlowError) {
    return { key: 'tooSlow' };
  }
  if (error instanceof TusRefusedError) {
    return error.status > 0 ? fromStatus(error.status) : { key: 'other', type: error.name };
  }
  if (error instanceof TusRetryableError) {
    return fromRetryable(error);
  }
  if (error instanceof TusFileError) {
    return { key: 'fileUnreadable' };
  }
  if (error instanceof RefusalError) {
    return { key: 'server' };
  }
  const status = storageStatus(error);
  if (status !== null) {
    return fromStatus(status);
  }
  if (isNetworkError(error)) {
    return { key: 'noNetwork' };
  }
  if (isDatabaseAnswer(error)) {
    return { key: 'server' };
  }
  const { name } = error as { name?: unknown };
  return { key: 'other', type: typeof name === 'string' && name !== '' ? name : 'object' };
}
