import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { wordContext } from '@/i18n';
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
      contentContainerStyle={layout.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text variant="title" accessibilityRole="header">
        {t('notifications.intro.heading', { context: wordContext() })}
      </Text>
      <Text>{t('notifications.intro.body', { context: wordContext() })}</Text>
      <Text tone="secondary">{t('notifications.intro.settingsHint')}</Text>
      {hasFailed ? (
        <Text accessibilityLiveRegion="polite" tone="danger">
          {t('notifications.intro.failed')}
        </Text>
      ) : null}
      <Button
        label={t('notifications.intro.allow')}
        onPress={() => void onAllow()}
        isBusy={isAsking}
      />
      <Button
        variant="outline"
        label={t('notifications.intro.later')}
        onPress={() => router.back()}
      />
    </ScrollView>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', gap: Spacing.lg, padding: Spacing.xl },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
