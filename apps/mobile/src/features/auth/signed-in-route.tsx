import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

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
  const styles = useThemedStyles(createStyles);
  const { userId, isLoading } = useSession();

  if (isLoading) {
    return (
      <View style={styles.centered} accessibilityLiveRegion="polite">
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{loadingText}</Text>
      </View>
    );
  }
  if (userId === null) {
    return <Redirect href="/sign-in" />;
  }
  return children;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
      backgroundColor: theme.background,
    },
    message: { fontSize: FontSize.body, color: theme.textSecondary, textAlign: 'center' },
  });
