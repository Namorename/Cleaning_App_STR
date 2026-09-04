import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/session';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { userId, isLoading } = useSession();

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
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.myTasks') }} />
      <Tabs.Screen name="queue" options={{ title: t('tabs.queue') }} />
    </Tabs>
  );
}
