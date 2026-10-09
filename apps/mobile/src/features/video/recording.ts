/**
 * The arithmetic of a recording, apart from the screen that draws it.
 *
 * The camera reports where it wrote the file and nothing else (`recordAsync`
 * answers `{ uri }`): the length is ours to measure, from the moment the
 * recording was asked for to the moment it was stopped. The server accepts a
 * video up to its limit plus 2 s (`add_task_media`), so a measurement a little
 * long for the camera's own start-up is still accepted — and it is capped at
 * the limit anyway, since the camera stops there itself.
 */

const MS_PER_SECOND = 1000;
const TENTHS_PER_SECOND = 10;

/**
 * What ended a recording: her «Стоп», the camera's own length or size limit,
 * or the app put away — each said differently on the preview.
 */
export type RecordingEnd = 'stop' | 'limit' | 'background';

/** How often the reader is told the time left: every ten seconds. */
export const ANNOUNCE_EVERY_SEC = 10;

/** The recording's length, in seconds to a tenth, never more than the limit. */
export function measuredSeconds(startedAt: number, endedAt: number, limitSec: number): number {
  const tenths = Math.round(((endedAt - startedAt) / MS_PER_SECOND) * TENTHS_PER_SECOND);
  return Math.min(limitSec, Math.max(0, tenths / TENTHS_PER_SECOND));
}

/** Whole seconds left before the limit, counting down from it. */
export function secondsLeft(elapsedMs: number, limitSec: number): number {
  return Math.max(0, limitSec - Math.floor(elapsedMs / MS_PER_SECOND));
}

/**
 * The time left as last said to the reader: the limit, then ten seconds less
 * every ten seconds. Between two announcements it stays as it was said, so a
 * screen reader is not handed a new number every second.
 */
export function announcedSecondsLeft(elapsedMs: number, limitSec: number): number {
  const steps = Math.floor(elapsedMs / (ANNOUNCE_EVERY_SEC * MS_PER_SECOND));
  return Math.max(0, limitSec - steps * ANNOUNCE_EVERY_SEC);
}

const SECONDS_PER_MINUTE = 60;

/** «1:05» — the countdown on the screen. */
export function clockText(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
