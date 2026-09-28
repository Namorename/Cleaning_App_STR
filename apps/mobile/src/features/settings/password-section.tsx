import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import {
  MIN_PASSWORD_LENGTH,
  passwordDraftIssue,
  passwordFailureText,
  type PasswordDraft,
  type PasswordIssue,
} from './password';
import { FailureNote, SettingsSection } from './section';
import { useChangePassword } from './use-settings';

const EMPTY_DRAFT: PasswordDraft = { current: '', next: '', repeat: '' };

/**
 * A new password while she is signed in: the current one, the new one twice.
 *
 * Checked on the phone first, so a typo in the repeat is caught without a
 * round trip; then the server checks the current password, sets the new one
 * and closes her other sign-ins. Online only — see `useChangePassword`.
 */
export function PasswordSection() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { session } = useSession();
  const change = useChangePassword();
  const [draft, setDraft] = useState<PasswordDraft>(EMPTY_DRAFT);
  const [issue, setIssue] = useState<PasswordIssue | null>(null);

  const onSubmit = () => {
    const found = passwordDraftIssue(draft);
    setIssue(found);
    if (found !== null) {
      change.reset();
      return;
    }
    change.mutate(
      { email: session?.user.email ?? '', current: draft.current, next: draft.next },
      { onSuccess: () => setDraft(EMPTY_DRAFT) },
    );
  };

  return (
    <SettingsSection title={t('settings.password.heading')}>
      <PasswordField
        id="password-current"
        label={t('settings.password.current')}
        value={draft.current}
        onChange={(current) => setDraft((before) => ({ ...before, current }))}
        isCurrent
        styles={styles}
      />
      <PasswordField
        id="password-new"
        label={t('settings.password.new')}
        value={draft.next}
        onChange={(next) => setDraft((before) => ({ ...before, next }))}
        styles={styles}
      />
      <PasswordField
        id="password-repeat"
        label={t('settings.password.repeat')}
        value={draft.repeat}
        onChange={(repeat) => setDraft((before) => ({ ...before, repeat }))}
        styles={styles}
      />

      {issue !== null ? (
        <FailureNote
          failure={{
            text: t(`settings.password.${issue}`, { min: MIN_PASSWORD_LENGTH }),
            detail: null,
          }}
        />
      ) : null}
      {change.isError ? <FailureNote failure={passwordFailureText(change.error)} /> : null}
      {change.isSuccess ? (
        <Text accessibilityLiveRegion="polite" style={styles.done}>
          {change.data.othersSignedOut
            ? t('settings.password.changed')
            : t('settings.password.othersStillIn')}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settings.password.submit')}
        accessibilityState={{ disabled: change.isPending, busy: change.isPending }}
        disabled={change.isPending}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.button,
          change.isPending && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        {change.isPending ? (
          <ActivityIndicator color={styles.buttonText.color} />
        ) : (
          <Text style={styles.buttonText}>{t('settings.password.submit')}</Text>
        )}
      </Pressable>
    </SettingsSection>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The one she already has, for the password manager; the others are new. */
  isCurrent?: boolean;
  styles: ReturnType<typeof createStyles>;
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  isCurrent = false,
  styles,
}: PasswordFieldProps) {
  return (
    <View style={styles.field}>
      <Text nativeID={id} style={styles.label}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={id}
        autoCapitalize="none"
        autoComplete={isCurrent ? 'current-password' : 'new-password'}
        autoCorrect={false}
        onChangeText={onChange}
        secureTextEntry
        style={styles.input}
        textContentType={isCurrent ? 'password' : 'newPassword'}
        value={value}
      />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    field: { gap: Spacing.xs },
    label: { color: theme.textSecondary, fontSize: FontSize.body },
    input: {
      minHeight: MIN_TOUCH_TARGET,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      fontSize: FontSize.title,
      color: theme.text,
      backgroundColor: theme.background,
    },
    done: { color: theme.calmText, fontSize: FontSize.body },
    button: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.xs,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonPressed: { opacity: 0.75 },
    buttonText: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
  });
