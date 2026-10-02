import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { checkConnection, goOffline } from '@/lib/online';

/**
 * The phone's network as a hint to the query client; the server stays the
 * authority on "online" (lib/online.ts).
 *
 * - Network lost: offline at once — the moves pause before one has to fail.
 * - Network back while offline: one look at the server. A connected Wi-Fi
 *   whose login page answers instead of the server, or a signal too weak to
 *   carry a request, keeps the app offline until a look succeeds.
 * - Not known yet (null, at start): nothing — the app does not start offline.
 *
 * NetInfo is not handed to TanStack's onlineManager directly: its canonical
 * wiring would mark the app online on any "connected" event, server or not.
 * Its own reachability check is off — on iOS it polls a Google address every
 * minute from every phone; the probe asks our server instead.
 */
export function watchNetwork(): () => void {
  if (Platform.OS === 'web') {
    return () => undefined;
  }
  NetInfo.configure({ reachabilityShouldRun: () => false });
  return NetInfo.addEventListener(({ isConnected }) => {
    if (isConnected === false) {
      goOffline();
    } else if (isConnected === true && !onlineManager.isOnline()) {
      void checkConnection();
    }
  });
}
