import { Redirect } from 'expo-router';

import { useSession } from '@/features/auth/session';
import { SettingsScreen } from '@/features/settings/settings-screen';

/**
 * The settings route. It sits on the root stack above the tabs, so the tabs'
 * own redirect does not reach it: signing out from here has to lead to the
 * sign-in screen by itself, or she would be left on settings for nobody.
 */
export default function SettingsRoute() {
  const { userId, isLoading } = useSession();

  if (isLoading) {
    return null;
  }
  if (userId === null) {
    return <Redirect href="/sign-in" />;
  }
  return <SettingsScreen />;
}
