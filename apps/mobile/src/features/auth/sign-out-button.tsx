import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { alertMessage, serverErrorText } from '@/lib/server-error';

import { signOut } from './session';

/**
 * Leaves the account. Asks first: on a shared phone the tap is easy to make
 * by mistake, and signing back in means typing a password in a stairwell.
 *
 * A failure is said in her language; auth's own English, when there is any,
 * follows as a paragraph of its own for her to pass on.
 */
export function SignOutButton() {
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
            Alert.alert(t('auth.signOutFailed'), alertMessage(serverErrorText(caught)));
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
