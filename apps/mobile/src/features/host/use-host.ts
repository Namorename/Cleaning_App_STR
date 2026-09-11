import { useQuery } from '@tanstack/react-query';

import { fetchHostSettings } from './api';
import { hostKeys } from './keys';

/** A company setting changes about once a year; asking hourly is plenty. */
const FRESH_FOR_MS = 60 * 60 * 1000;

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
  const settings = useQuery({
    queryKey: hostKeys.settings(),
    queryFn: fetchHostSettings,
    staleTime: FRESH_FOR_MS,
  });

  return settings.data?.gallery_allowed ?? false;
}
