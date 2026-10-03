import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { tabBarIcon } from '@/components/icon';
import { useSession } from '@/features/auth/session';
import { usePermissionPrompt, usePushTaps } from '@/features/push/hooks';
import { renderSettingsButton } from '@/features/settings/settings-button';

// Built once: the navigator gets the same function on every render. They take
// the place of the navigator's placeholder glyph, in its box and its tint.
const TAB_ICON = {
  index: tabBarIcon('nav.myTasks'),
  queue: tabBarIcon('nav.queue'),
  problems: tabBarIcon('nav.problems'),
  supplies: tabBarIcon('nav.supplies'),
} as const;

export default function TabsLayout() {
  const { t } = useTranslation();
  const { userId, isLoading } = useSession();

  // Here rather than at the root: the navigator is up and her session has
  // been read, so a tapped push opens its screen instead of racing the
  // redirect to sign-in, and the explainer is shown to someone signed in.
  usePushTaps(userId);
  usePermissionPrompt(userId);

  if (isLoading) {
    return null;
  }

  // Belt and braces next to row level security: hiding the screens keeps a
  // signed-out cleaner from seeing a flash of an empty list, but the data is
  // protected by the server either way.
  if (userId === null) {
    return <Redirect href="/sign-in" />;
  }

  return (
    // The gear opens the settings; signing out lives at the bottom of them.
    <Tabs screenOptions={{ headerShown: true, headerRight: renderSettingsButton }}>
      <Tabs.Screen
        name="index"
        options={{ title: t('tabs.myTasks'), tabBarIcon: TAB_ICON.index }}
      />
      <Tabs.Screen name="queue" options={{ title: t('tabs.queue'), tabBarIcon: TAB_ICON.queue }} />
      <Tabs.Screen
        name="problems"
        options={{ title: t('tabs.problems'), tabBarIcon: TAB_ICON.problems }}
      />
      <Tabs.Screen
        name="supplies"
        options={{ title: t('tabs.supplies'), tabBarIcon: TAB_ICON.supplies }}
      />
    </Tabs>
  );
}
