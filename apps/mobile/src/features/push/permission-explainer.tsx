import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { reportError, reportUnlessOffline } from '@/lib/sentry';

import { ensureChannels } from './channels';
import { registerThisPhone } from './registration';

/**
 * Why the app wants to send notifications, said before the system asks.
 *
 * The system question comes once on an iPhone and twice on Android; a "no"
 * given to a bare question is final there, so it is asked only after she has
 * read what she gets — and what she never gets: the text of a message.
 * "Allow" makes the Android channels first (Android 13 shows its question
 * only once one exists), asks, closes, and registers the phone behind the
 * closed screen if she said yes.
 * "Not now" asks nothing; the app offers again on its next start, and the
 * Settings keep the way to turn them on.
 */
export function PermissionExplainer() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const [isAsking, setAsking] = useState(false);
  const [hasFailed, setFailed] = useState(false);

  const onAllow = async () => {
    setAsking(true);
    setFailed(false);
    try {
      await ensureChannels();
      const permission = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
      if (permission.granted && userId !== null) {
        // Behind the closed screen: registering goes to Apple or Google, Expo
        // and the server, and every start and return to the app tries again.
        registerThisPhone(userId).catch(reportUnlessOffline);
      }
      router.back();
    } catch (error: unknown) {
      reportError(error);
      setFailed(true);
      setAsking(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text accessibilityRole="header" style={styles.heading}>
        {t('notifications.intro.heading')}
      </Text>
      <Text style={styles.body}>{t('notifications.intro.body')}</Text>
      <Text style={styles.hint}>{t('notifications.intro.settingsHint')}</Text>
      {hasFailed ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {t('notifications.intro.failed')}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('notifications.intro.allow')}
        accessibilityState={{ disabled: isAsking, busy: isAsking }}
        disabled={isAsking}
        onPress={() => void onAllow()}
        style={({ pressed }) => [styles.allow, pressed && styles.pressed]}
      >
        {isAsking ? (
          <ActivityIndicator color={theme.onPrimary} />
        ) : (
          <Text style={styles.allowText}>{t('notifications.intro.allow')}</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('notifications.intro.later')}
        onPress={() => router.back()}
        style={({ pressed }) => [styles.later, pressed && styles.pressed]}
      >
        <Text style={styles.laterText}>{t('notifications.intro.later')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { flexGrow: 1, justifyContent: 'center', gap: Spacing.lg, padding: Spacing.xl },
    heading: { color: theme.text, fontSize: FontSize.title, fontWeight: '700' },
    body: { color: theme.text, fontSize: FontSize.body },
    hint: { color: theme.textSecondary, fontSize: FontSize.body },
    error: { color: theme.danger, fontSize: FontSize.body },
    allow: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    allowText: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
    later: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
    laterText: { color: theme.primary, fontSize: FontSize.body, fontWeight: '600' },
    pressed: { opacity: 0.75 },
  });
