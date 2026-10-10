import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { readCached } from '@/lib/read-cached';

import { fetchHostSettings } from './api';
import { hostKeys } from './keys';
import {
  hostSettingsSchema,
  videoSettingsOf,
  type HostSettings,
  type VideoSettings,
} from './schema';

/** A company setting changes about once a year; asking hourly is plenty. */
const FRESH_FOR_MS = 60 * 60 * 1000;

/**
 * Where a setting is about to decide what she can do — a media step, as it
 * opens — a copy older than this is read again (owner, 2026-10-10: the
 * gallery switch reaches a step at once, not within the hour).
 */
export const ON_OPEN_FRESH_MS = 5 * 60 * 1000;

/**
 * The company row restored from disk is in the shape the build that saved it
 * read (`readCached`): the build before video saved it without the three
 * video numbers, which the schema reads as unknown.
 */
function readHostSettings(data: unknown): HostSettings {
  return readCached(hostSettingsSchema, data, 'company settings');
}

/**
 * Fresh for an hour — unless the row in the cache lacks the video numbers
 * this build needs, as one saved by the build before video does: that row is
 * read again at once, however recently it was saved.
 */
function freshFor(query: { state: { data: unknown } }): number {
  const parsed = hostSettingsSchema.safeParse(query.state.data);
  return parsed.success && videoSettingsOf(parsed.data) !== null ? FRESH_FOR_MS : 0;
}

/**
 * The company's settings, from the cache on disk first and refreshed hourly —
 * or, where a screen says so (`freshWithinMs`), read again as it opens when
 * the copy is older than that.
 */
export function useHostSettings(freshWithinMs?: number): UseQueryResult<HostSettings, Error> {
  return useQuery({
    queryKey: hostKeys.settings(),
    queryFn: fetchHostSettings,
    select: readHostSettings,
    staleTime:
      freshWithinMs === undefined
        ? freshFor
        : (query: { state: { data: unknown } }) => Math.min(freshFor(query), freshWithinMs),
  });
}

/**
 * May this cleaner attach files from her gallery?
 *
 * False until the server says otherwise, and that is the whole design of the
 * answer. The query cache is on disk, so a phone that has read the setting
 * keeps it through a restart and down a lift shaft; a phone that has never
 * read it, or whose read failed, falls back to the camera. The safe reading
 * is the restrictive one: showing a gallery button the company never allowed
 * would let through exactly the file the setting exists to keep out.
 */
export function useGalleryAllowed(freshWithinMs?: number): boolean {
  return useHostSettings(freshWithinMs).data?.gallery_allowed ?? false;
}

/**
 * The company's numbers for a recording, or null while they are unknown.
 *
 * Unknown means never read, or saved by a build that did not read them, and
 * no signal to read them now. The recording waits rather than guess: a
 * guessed length longer than the company's is a video the server refuses
 * after she has waited for its upload.
 */
export function useVideoSettings(freshWithinMs?: number): VideoSettings | null {
  const settings = useHostSettings(freshWithinMs).data;
  const seconds = settings?.video_max_sec;
  const kbps = settings?.video_bitrate_kbps;
  const megabytes = settings?.video_max_mb;

  // The same object while the numbers stay the same: screens hand it to effects.
  return useMemo(
    () =>
      videoSettingsOf({
        video_max_sec: seconds,
        video_bitrate_kbps: kbps,
        video_max_mb: megabytes,
      }),
    [seconds, kbps, megabytes],
  );
}
