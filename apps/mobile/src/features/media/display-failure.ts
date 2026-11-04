import { onlineManager } from '@tanstack/react-query';

import { reportMediaTrouble } from '@/lib/sentry';

import type { MediaKind } from './schema';

/** Where a file was being drawn when it would not show. */
export type MediaSurface = 'strip' | 'step' | 'chat' | 'viewer';

/** Where it was drawn from: a file on the phone, or a signed link. */
export type MediaSource = 'local' | 'remote';

/**
 * Why, in a word, out of the platform's own text — which is never sent: on
 * Android it carries the link, and a signed link is a key to the file.
 */
export type DisplayFailureReason =
  `http-${number}` | 'network' | 'timeout' | 'no-file' | 'decode' | 'other';

export interface DisplayFailure {
  mediaId: string;
  kind: MediaKind;
  surface: MediaSurface;
  /** What the picture was drawn from, as handed to the image or the player. */
  uri: string;
  /** The image's or the player's own words; read here, never sent. */
  message: string | undefined;
}

const HTTP_STATUS = /\b(?:status|response)\s*code\D{0,24}([45]\d\d)\b/i;
const NETWORK =
  /unknownhost|unable to resolve|not connected to the internet|network connection was lost|failed to connect|could not connect|offline|\bENOTFOUND\b|\bECONN(?:REFUSED|RESET)\b/i;
const TIMEOUT = /timed?\s?out/i;
const NO_FILE = /no such file|ENOENT|FileNotFound|does not exist|not found/i;
const DECODE = /decod|unsupported|corrupt|format/i;

/** The word for a failure, from the platform's text; anything unrecognised is `other`. */
export function displayFailureReason(message: string | undefined): DisplayFailureReason {
  if (message === undefined) {
    return 'other';
  }
  const status = HTTP_STATUS.exec(message);
  if (status !== null) {
    return `http-${Number(status[1])}`;
  }
  if (NETWORK.test(message)) {
    return 'network';
  }
  if (TIMEOUT.test(message)) {
    return 'timeout';
  }
  if (NO_FILE.test(message)) {
    return 'no-file';
  }
  return DECODE.test(message) ? 'decode' : 'other';
}

export function mediaSourceOf(uri: string): MediaSource {
  return /^https?:/i.test(uri) ? 'remote' : 'local';
}

/** The failures already reported in this run, by surface and file: a list redrawn reports none twice. */
const reported = new Set<string>();

/**
 * A photo or a video that would not show — as a Sentry message, once per
 * file and place in a run (lib/sentry.ts, `reportMediaTrouble`). The web
 * panel showed every file while the phone showed none bigger than a tile
 * (2026-11-02): a thumbnail that fails says nothing to anyone, and without
 * this neither would one the viewer cannot open.
 *
 * Sent: the kind, the place, where it came from and why in a word, and the
 * file's id — never the link, the path or the platform's text. Nothing is
 * sent for a link that could not be fetched without signal: that is the
 * stairwell, not a fault.
 */
export function reportMediaNotShown(failure: DisplayFailure): void {
  const key = `${failure.surface}:${failure.mediaId}`;
  if (reported.has(key)) {
    return;
  }
  const source = mediaSourceOf(failure.uri);
  const reason = displayFailureReason(failure.message);
  const isStairwell =
    source === 'remote' &&
    (reason === 'network' || reason === 'timeout' || !onlineManager.isOnline());
  if (isStairwell) {
    return;
  }
  reported.add(key);
  reportMediaTrouble(
    'Media not shown',
    { kind: failure.kind, surface: failure.surface, source, reason },
    { mediaId: failure.mediaId },
  );
}
