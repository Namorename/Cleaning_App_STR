import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { tabBarIcon } from '@/components/icon';
import { renderTabBar } from '@/components/tab-bar';
import { isTechnician, wordContextOf } from '@/features/auth/role';
import { useSession } from '@/features/auth/session';
import { useRole } from '@/features/auth/use-role';
import { usePermissionPrompt, usePushTaps } from '@/features/push/hooks';
import { renderSettingsButton } from '@/features/settings/settings-button';

// Built once: the navigator gets the same function on every render. The bar
// draws each in its tint, filled on the active tab's pill.
const TAB_ICON = {
  myTasks: tabBarIcon('nav.myTasks'),
  myJobs: tabBarIcon('nav.myJobs'),
  queue: tabBarIcon('nav.queue'),
  problems: tabBarIcon('nav.problems'),
  supplies: tabBarIcon('nav.supplies'),
} as const;

/**
 * A screen kept out of the bar: expo-router turns `href: null` into a tab that
 * draws nothing, and the phone's bar skips it (components/tab-bar.tsx). It
 * stays declared — a route file left undeclared would get a tab of its own.
 */
const HIDDEN = { href: null } as const;

export default function TabsLayout() {
  const { t } = useTranslation();
  const { userId, isLoading } = useSession();
  const role = useRole();

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

  // The technician and the head technician have nothing to do with cleanings
  // (docs/tech-plan.md §4): their first tab is their own work, «Мои работы»,
  // and there is no free queue and no supplies. Only what is offered changes;
  // what they read is the server's to decide. Any other role — and one this
  // build does not know — gets the cleaner's four.
  const isTech = isTechnician(role);
  const context = wordContextOf(role);
  const forCleanersOnly = isTech ? HIDDEN : undefined;

  return (
    // The gear opens the settings; signing out lives at the bottom of them.
    // The tab bar is the phone's own (components/tab-bar.tsx).
    <Tabs
      tabBar={renderTabBar}
      screenOptions={{ headerShown: true, headerRight: renderSettingsButton }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.myTasks', { context }),
          tabBarIcon: isTech ? TAB_ICON.myJobs : TAB_ICON.myTasks,
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{ title: t('tabs.queue'), tabBarIcon: TAB_ICON.queue, ...forCleanersOnly }}
      />
      <Tabs.Screen
        name="problems"
        options={{ title: t('tabs.problems', { context }), tabBarIcon: TAB_ICON.problems }}
      />
      <Tabs.Screen
        name="supplies"
        options={{ title: t('tabs.supplies'), tabBarIcon: TAB_ICON.supplies, ...forCleanersOnly }}
      />
    </Tabs>
  );
}
