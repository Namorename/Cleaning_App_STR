import { useSession } from '@/features/auth/session';

import { usePushRefresh, usePushRegistration } from './hooks';

/**
 * The push wiring that belongs to the whole app rather than a screen: this
 * phone registered for whoever is signed in, and a push arriving while the
 * app is open refreshing what it is about. Draws nothing.
 */
export function PushBridge() {
  const { userId } = useSession();
  usePushRegistration(userId);
  usePushRefresh();
  return null;
}
