import { useSession } from '@/features/auth/session';

import { usePendingRelease, usePushRefresh, usePushRegistration } from './hooks';

/**
 * The push wiring that belongs to the whole app rather than a screen: this
 * phone registered for whoever is signed in, a token left bound by a sign-out
 * nobody heard let go of, and a push arriving while the app is open
 * refreshing what it is about. Draws nothing.
 */
export function PushBridge() {
  const { userId } = useSession();
  usePendingRelease();
  usePushRegistration(userId);
  usePushRefresh();
  return null;
}
