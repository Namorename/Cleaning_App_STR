import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/components/icon-button';

/**
 * The gear in the tab header, where "Sign out" used to be: Lucide's settings
 * icon on a 48 dp target. An icon alone, so its name is spoken from the
 * label: the title of the screen it opens.
 */
export function SettingsButton() {
  const { t } = useTranslation();

  return (
    <IconButton
      icon="nav.settings"
      accessibilityLabel={t('settings.title')}
      onPress={() => router.push('/settings')}
    />
  );
}

/** For `headerRight`, which is called as a function, not drawn as a component. */
export function renderSettingsButton() {
  return <SettingsButton />;
}
