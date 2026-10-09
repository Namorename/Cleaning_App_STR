import type { TFunction } from 'i18next';

import { CameraDeniedError, MediaLibraryDeniedError } from './capture';

/**
 * Why a file did not get attached, in the cleaner's language.
 *
 * Three screens attach media — a step of a task, a new problem report, and an
 * open one — and each used to spell out its own version of the same two
 * cases. One decision here keeps them saying the same thing about the same
 * refusal. A video has a recording screen of its own, with its own words.
 */
export function attachFailure(error: unknown, t: TFunction): string {
  if (error instanceof CameraDeniedError) {
    return t('steps.cameraDenied');
  }
  if (error instanceof MediaLibraryDeniedError) {
    return t('steps.galleryDenied');
  }
  return t('steps.captureFailed');
}
