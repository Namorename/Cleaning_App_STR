import type { TFunction } from 'i18next';

import { CameraDeniedError, MediaLibraryDeniedError, VideoTooLongError } from './capture';

/**
 * Why a file did not get attached, in the cleaner's language.
 *
 * Three screens attach media — a step of a task, a new problem report, and an
 * open one — and each used to spell out its own version of the same two
 * cases. There are four now, and four copies of a decision is how two of
 * them end up saying different things about the same refusal.
 */
export function attachFailure(error: unknown, t: TFunction): string {
  if (error instanceof CameraDeniedError) {
    return t('steps.cameraDenied');
  }
  if (error instanceof MediaLibraryDeniedError) {
    return t('steps.galleryDenied');
  }
  if (error instanceof VideoTooLongError) {
    return t('steps.videoTooLong', { seconds: error.maxSeconds });
  }
  return t('steps.captureFailed');
}
