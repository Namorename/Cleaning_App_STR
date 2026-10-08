import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useTheme } from '@/hooks/use-theme';

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
  const theme = useTheme();
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
        label={t('settings.password.current')}
        value={draft.current}
        onChange={(current) => setDraft((before) => ({ ...before, current }))}
        isCurrent
      />
      <PasswordField
        label={t('settings.password.new')}
        value={draft.next}
        onChange={(next) => setDraft((before) => ({ ...before, next }))}
      />
      <PasswordField
        label={t('settings.password.repeat')}
        value={draft.repeat}
        onChange={(repeat) => setDraft((before) => ({ ...before, repeat }))}
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
        <Text accessibilityLiveRegion="polite" color={theme.tone.done.fg}>
          {t('settings.password.changed')}
        </Text>
      ) : null}

      <Button
        label={t('settings.password.submit')}
        onPress={onSubmit}
        isBusy={change.isPending}
        style={styles.submit}
      />
    </SettingsSection>
  );
}

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The one she already has, for the password manager; the others are new. */
  isCurrent?: boolean;
}

/** A password as a text field: its label above, masked, with the eye that shows it. */
function PasswordField({ label, value, onChange, isCurrent = false }: PasswordFieldProps) {
  return (
    <TextField
      isPassword
      label={label}
      autoComplete={isCurrent ? 'current-password' : 'new-password'}
      onChangeText={onChange}
      textContentType={isCurrent ? 'password' : 'newPassword'}
      value={value}
    />
  );
}

/** Sizes only: the colours are the components'. */
const styles = StyleSheet.create({
  submit: { marginTop: Spacing.xs },
});
