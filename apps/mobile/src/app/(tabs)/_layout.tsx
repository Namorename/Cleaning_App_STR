import { Redirect, Tabs } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Spacing, type Theme } from '@/constants/theme';
import { signOut, useSession } from '@/features/auth/session';
import { useThemedStyles } from '@/hooks/use-themed-styles';

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
    <Tabs screenOptions={{ headerShown: true, headerRight: SignOutButton }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.myTasks') }} />
      <Tabs.Screen name="queue" options={{ title: t('tabs.queue') }} />
    </Tabs>
  );
}

/**
 * Leaves the account. Asks first: on a shared phone the tap is easy to make
 * by mistake, and signing back in means typing a password in a stairwell.
 */
function SignOutButton() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  const onPress = useCallback(() => {
    Alert.alert(t('auth.signOutTitle'), t('auth.signOutQuestion'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: () => {
          signOut().catch((caught: unknown) => {
            Alert.alert(
              t('auth.signOutFailed'),
              caught instanceof Error ? caught.message : undefined,
            );
          });
        },
      },
    ]);
  }, [t]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('auth.signOut')}
      onPress={onPress}
      hitSlop={Spacing.sm}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.label}>{t('auth.signOut')}</Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    button: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      paddingHorizontal: Spacing.lg,
    },
    buttonPressed: { opacity: 0.6 },
    label: { color: theme.primary, fontSize: FontSize.body, fontWeight: '600' },
  });
