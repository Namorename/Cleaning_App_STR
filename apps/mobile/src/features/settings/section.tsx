import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { i18n } from '@/i18n';
import { serverErrorKey, serverErrorText, type ServerErrorText } from '@/lib/server-error';

interface SettingsSectionProps {
  title: string;
  /** One line under the title saying what the section decides. */
  hint?: string;
  children: ReactNode;
}

/** A titled block of the settings screen; the title is a header for a screen reader. */
export function SettingsSection({ title, hint, children }: SettingsSectionProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

interface FailureNoteProps {
  failure: ServerErrorText;
}

/**
 * A failure as the screen says it: the sentence in her language, and the
 * server's own English small underneath when there is some, for her to
 * forward to the manager.
 */
export function FailureNote({ failure }: FailureNoteProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View accessibilityLiveRegion="polite" style={styles.failure}>
      <Text style={styles.error}>{failure.text}</Text>
      {failure.detail !== null ? <Text style={styles.errorDetail}>{failure.detail}</Text> : null}
    </View>
  );
}

/**
 * A failed save, said as what did not happen. A refusal the server named is
 * translated as the server named it; anything else reads as `fallbackKey` —
 * "the choice was not saved" says more here than the app's general sentence —
 * with the raw words under it.
 */
export function failureOf(error: unknown, fallbackKey: string): ServerErrorText {
  const translated = serverErrorText(error);
  return serverErrorKey(error) !== null
    ? translated
    : { text: i18n.t(fallbackKey), detail: translated.detail };
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    section: {
      gap: Spacing.sm,
      padding: Spacing.lg,
      borderRadius: Radius.lg,
      backgroundColor: theme.card,
    },
    heading: { color: theme.text, fontSize: FontSize.title, fontWeight: '700' },
    hint: { color: theme.textSecondary, fontSize: FontSize.body },
    failure: { gap: Spacing.xs },
    error: { color: theme.danger, fontSize: FontSize.body },
    errorDetail: { color: theme.textSecondary, fontSize: FontSize.caption },
  });
