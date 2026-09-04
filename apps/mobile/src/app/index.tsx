import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/**
 * Entry point. Reading the stored session from the Keychain is asynchronous,
 * so redirecting before it resolves would bounce a signed-in cleaner to the
 * login screen on every cold start.
 */
export default function Index() {
  const styles = useThemedStyles(createStyles);
  const { userId, isLoading } = useSession();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>Входим…</Text>
      </View>
    );
  }

  return userId === null ? <Redirect href="/sign-in" /> : <Redirect href="/(tabs)" />;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      backgroundColor: theme.background,
    },
    message: { fontSize: FontSize.body, color: theme.textSecondary },
  });
