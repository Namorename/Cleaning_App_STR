import { ScrollView, StyleSheet, View } from 'react-native';

import { Spacing, type Theme } from '@/constants/theme';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { LanguageSection } from './language-section';
import { PasswordSection } from './password-section';
import { PushSection } from './push-section';

/**
 * What a cleaner can set for herself: which pushes she gets, the language she
 * reads, her password — and, at the bottom, the way out, which used to sit in
 * the tab header where a stray tap found it (owner's decision 14).
 *
 * Deliberately plain: the redesign repaints it (docs/f11-plan.md §3).
 */
export function SettingsScreen() {
  const styles = useThemedStyles(createStyles);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      // The password fields sit low; the keyboard must not cover the one she types in.
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <PushSection />
      <LanguageSection />
      <PasswordSection />
      <View style={styles.signOut}>
        <SignOutButton />
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.lg },
    signOut: { alignItems: 'center' },
  });
