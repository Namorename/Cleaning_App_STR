import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { readCached } from '@/lib/read-cached';

import { fetchHostSettings } from './api';
import { hostKeys } from './keys';
import { hostSettingsSchema, type HostSettings, type VideoSettings } from './schema';

/** A company setting changes about once a year; asking hourly is plenty. */
const FRESH_FOR_MS = 60 * 60 * 1000;

/**
 * The company row restored from disk is in the shape the build that saved it
 * read (`readCached`): the build before video saved it without the three
 * video numbers, which the schema fills with the server's defaults.
 */
function readHostSettings(data: unknown): HostSettings {
  return readCached(hostSettingsSchema, data, 'company settings');
}

/** The company's settings, from the cache on disk first and refreshed hourly. */
export function useHostSettings(): UseQueryResult<HostSettings, Error> {
  return useQuery({
    queryKey: hostKeys.settings(),
    queryFn: fetchHostSettings,
    select: readHostSettings,
    staleTime: FRESH_FOR_MS,
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
export function useGalleryAllowed(): boolean {
  return useHostSettings().data?.gallery_allowed ?? false;
}

/**
 * The company's numbers for a recording, or null while they are unknown.
 *
 * Unknown means never read and no signal to read them now. The recording
 * waits rather than guess: a guessed length longer than the company's is a
 * video the server refuses after she has waited for its upload.
 */
export function useVideoSettings(): VideoSettings | null {
  const settings = useHostSettings().data;
  const seconds = settings?.video_max_sec;
  const kbps = settings?.video_bitrate_kbps;
  const megabytes = settings?.video_max_mb;

  // The same object while the numbers stay the same: screens hand it to effects.
  return useMemo(
    () =>
      seconds === undefined || kbps === undefined || megabytes === undefined
        ? null
        : { video_max_sec: seconds, video_bitrate_kbps: kbps, video_max_mb: megabytes },
    [seconds, kbps, megabytes],
  );
}
