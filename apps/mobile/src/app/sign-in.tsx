import { Redirect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { ActionBar } from '@/components/action-bar';
import { useKeyboardOffset } from '@/components/bottom-inset';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Spacing, type Theme } from '@/constants/theme';
import { signInFailureText } from '@/features/auth/failure';
import { signIn, useSession } from '@/features/auth/session';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ServerErrorText } from '@/lib/server-error';

/** The bottom edge is the action bar's: it clears the system's bar itself. */
const SAFE_EDGES: readonly Edge[] = ['top', 'left', 'right'];

export default function SignInScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<ServerErrorText | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const keyboardOffset = useKeyboardOffset();

  const onSubmit = useCallback(async () => {
    // The keyboard goes, as «Go» already makes it go: with it open, a refusal
    // under the fields can sit below what is left of the screen, and the
    // button just turning back to «Войти» says nothing.
    Keyboard.dismiss();
    setFailure(null);
    setIsSubmitting(true);
    try {
      // Trimmed because this password arrives by copy: out of the panel's
      // dialog, out of a letter, off a note. A trailing space picked up on the
      // way is invisible in a masked field and reads as a wrong password. No
      // generated password has one — the alphabet has no whitespace in it —
      // so nothing correct is lost by dropping it.
      await signIn(email.trim(), password.trim());
    } catch (caught: unknown) {
      // Which half was wrong is still never said — that would turn the form
      // into an account enumerator. What did happen is.
      const refusal = signInFailureText(caught);
      setFailure(refusal);
      // TalkBack reads the live region below; VoiceOver has none, so on iOS
      // the refusal is said aloud — once, not on both systems.
      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(refusal.text);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password]);

  if (userId !== null) {
    return <Redirect href="/(tabs)" />;
  }

  const hasBothFields = email.trim().length > 0 && password.length > 0;
  const canSubmit = hasBothFields && !isSubmitting;

  // «Go» on the password's keyboard is the button, with the button's rules.
  const submitFromKeyboard = () => {
    if (canSubmit) {
      void onSubmit();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={SAFE_EDGES}>
      {/* Padding on both systems, as the forms do: the view measures how much
          of it the keyboard covers, so it adds nothing where the system has
          made room, and with Android drawing edge to edge the system does
          not. No header above it: the offset only takes back the inset the
          action bar rises by (components/bottom-inset.ts). */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={keyboardOffset}
        style={styles.screen}
      >
        {/* From the top, not centred: «Войти» lives at the bottom edge, in
            the thumb's reach, and never under the keyboard. */}
        <ScrollView
          testID="sign-in-form"
          style={styles.screen}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <BrandMark testID="brand-mark" style={styles.mark} />
          <Text variant="heading" align="center" accessibilityRole="header">
            {t('auth.heading')}
          </Text>

          <TextField
            label={t('auth.email')}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            textContentType="username"
            value={email}
          />
          <TextField
            isPassword
            label={t('auth.password')}
            onChangeText={setPassword}
            onSubmitEditing={submitFromKeyboard}
            returnKeyType="go"
            textContentType="password"
            value={password}
          />

          {failure !== null ? (
            <View
              testID="sign-in-failure"
              accessibilityLiveRegion="polite"
              style={styles.failure}
            >
              <Text tone="danger">{failure.text}</Text>
              {failure.detail !== null ? (
                // The server's own English, for a failure this build cannot
                // name. Small, under the sentence she can read, so she can
                // forward it to the manager.
                <Text variant="caption" tone="secondary">
                  {failure.detail}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* No letter can reset it before launch: there is no mail server
              yet, and the manager resets it in the panel (owner's decision 16). */}
          <Text tone="secondary" align="center">
            {t('auth.forgotPassword')}
          </Text>
        </ScrollView>

        <ActionBar isAtScreenEdge testID="sign-in-actions">
          <Button
            label={isSubmitting ? t('auth.signingIn') : t('auth.submit')}
            onPress={() => void onSubmit()}
            isDisabled={!hasBothFields}
            isBusy={isSubmitting}
          />
        </ActionBar>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    screen: { flex: 1 },
    content: { padding: Spacing.xl, gap: Spacing.lg },
    mark: { alignSelf: 'center' },
    failure: { gap: Spacing.xs },
  });
