import { ScrollView, StyleSheet, View } from 'react-native';

import { Spacing, type Theme } from '@/constants/theme';
import { SignOutButton } from '@/features/auth/sign-out-button';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { AboutSection } from './about-section';
import { LanguageSection } from './language-section';
import { PasswordSection } from './password-section';
import { PushSection } from './push-section';
import { ThemeSection } from './theme-section';

/**
 * What a cleaner can set for herself: which pushes she gets, the language she
 * reads, the theme, her password; what the app owes to others (the font's
 * licence) — and, at the bottom, the way out, which used to sit in the tab
 * header where a stray tap found it (owner's decision 14).
 *
 * The sections are cards of the design system (5.2); the rest of the screen
 * is repainted in 5.4 (docs/redesign-plan.md §2.4).
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
      <ThemeSection />
      <PasswordSection />
      <AboutSection />
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
