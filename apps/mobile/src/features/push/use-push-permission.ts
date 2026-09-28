import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useSession } from '@/features/auth/session';
import { reportError } from '@/lib/sentry';

import { ensureChannels, type PushChannel } from './channels';
import {
  offChannels,
  permissionState,
  readPermissionState,
  type PermissionState,
} from './permission';
import { registerThisPhone } from './registration';

const NO_CHANNELS: readonly PushChannel[] = [];

export interface PushPermission {
  /** Null until read — and always on the web, which has no pushes. */
  state: PermissionState | null;
  /** Android channels she switched off; empty elsewhere. */
  offChannels: readonly PushChannel[];
  isRequesting: boolean;
  /** Ask the system now; registers the phone if she says yes. */
  request: () => void;
}

/**
 * What the phone allows, read on opening and whenever the app comes back to
 * the front — she changes it in the system settings, outside the app. Kept
 * in the component, not the query cache: the cache is written to disk, and a
 * permission read yesterday says nothing about today.
 */
export function usePushPermission(): PushPermission {
  const { userId } = useSession();
  const [state, setState] = useState<PermissionState | null>(null);
  const [channelsOff, setChannelsOff] = useState<readonly PushChannel[]>(NO_CHANNELS);
  const [isRequesting, setRequesting] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    let isCurrent = true;
    const read = () => {
      Promise.all([readPermissionState(), offChannels()])
        .then(([next, off]) => {
          if (isCurrent) {
            setState(next);
            setChannelsOff(off);
          }
        })
        .catch(reportError);
    };
    read();
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        read();
      }
    });
    return () => {
      isCurrent = false;
      appState.remove();
    };
  }, []);

  const request = useCallback(() => {
    setRequesting(true);
    const asking = async () => {
      await ensureChannels();
      const permission = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
      const next = permissionState(permission);
      // Still undecided after asking: the phone never showed the question
      // (Android 12 with notifications off, a dialog swiped away). The
      // settings are the way now.
      setState(next === 'ask' ? 'blocked' : next);
      if (permission.granted && userId !== null) {
        await registerThisPhone(userId);
      }
    };
    asking()
      .catch(reportError)
      .finally(() => setRequesting(false));
  }, [userId]);

  return { state, offChannels: channelsOff, isRequesting, request };
}
