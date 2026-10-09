import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { LoadingState } from '@/components/loading-state';

import { useSession } from './session';

interface SignedInRouteProps {
  /** Said while the stored session is read, in the words of the screen to come. */
  loadingText: string;
  children: ReactNode;
}

/**
 * The guard of a route on the root stack, where the tabs' own redirect does
 * not reach.
 *
 * A tap on a notification opens the app cold, straight onto such a route —
 * a cleaning, a thread — before the stored session has been read from the
 * Keychain. Until it has, the screen below would see no user and say "not
 * found", which is false; so it waits, and says so. Signed out, it leads to
 * the sign-in screen: signing out from settings ends here too. The screen
 * itself is drawn only for a known user, so its hooks never run for nobody.
 */
export function SignedInRoute({ loadingText, children }: SignedInRouteProps) {
  const { userId, isLoading } = useSession();

  if (isLoading) {
    return <LoadingState label={loadingText} />;
  }
  if (userId === null) {
    return <Redirect href="/sign-in" />;
  }
  return children;
}
