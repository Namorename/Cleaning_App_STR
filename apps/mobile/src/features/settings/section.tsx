import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { i18n } from '@/i18n';
import { serverErrorKey, serverErrorText, type ServerErrorText } from '@/lib/server-error';

interface SettingsSectionProps {
  title: string;
  /** One line under the title saying what the section decides. */
  hint?: string;
  children: ReactNode;
}

/**
 * A titled block of the settings screen — a card of the design system; the
 * title is a header for a screen reader.
 */
export function SettingsSection({ title, hint, children }: SettingsSectionProps) {
  return (
    <Card>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {hint !== undefined ? <Text tone="secondary">{hint}</Text> : null}
      {children}
    </Card>
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
  return (
    <View accessibilityLiveRegion="polite" style={styles.failure}>
      <Text tone="danger">{failure.text}</Text>
      {failure.detail !== null ? (
        <Text variant="caption" tone="secondary">
          {failure.detail}
        </Text>
      ) : null}
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

/** Sizes only: the colours are the text component's. */
const styles = StyleSheet.create({
  failure: { gap: Spacing.xs },
});
