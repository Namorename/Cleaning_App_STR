import { useTranslation } from 'react-i18next';

import { SignedInRoute } from '@/features/auth/signed-in-route';
import { SettingsScreen } from '@/features/settings/settings-screen';

/**
 * The settings route. It sits on the root stack above the tabs, so the tabs'
 * own redirect does not reach it: signing out from here has to lead to the
 * sign-in screen by itself, or she would be left on settings for nobody. The
 * guard is the one a cleaning and a thread use, wait included.
 */
export default function SettingsRoute() {
  const { t } = useTranslation();

  return (
    <SignedInRoute loadingText={t('settings.loading')}>
      <SettingsScreen />
    </SignedInRoute>
  );
}
