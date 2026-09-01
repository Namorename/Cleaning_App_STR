import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session';

/**
 * Entry point. Reading the stored session from the Keychain is asynchronous,
 * so redirecting before it resolves would bounce a signed-in cleaner to the
 * login screen on every cold start.
 */
export default function Index() {
  const { userId, isLoading } = useSession();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.message}>Входим…</Text>
      </View>
    );
  }

  return userId === null ? <Redirect href="/sign-in" /> : <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  message: { fontSize: FontSize.body, color: '#60646C' },
});
