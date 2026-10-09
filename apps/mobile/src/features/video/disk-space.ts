import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { reportError } from '@/lib/sentry';

/**
 * Bytes free on the phone's storage, or null where it cannot be told — the
 * browser build, or a phone whose file system will not say. A null is not a
 * reason to refuse a recording: the camera's own size limit still holds.
 */
export function freeDiskBytes(): number | null {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const free = Paths.availableDiskSpace;
    return Number.isFinite(free) && free >= 0 ? free : null;
  } catch (error: unknown) {
    reportError(error);
    return null;
  }
}
