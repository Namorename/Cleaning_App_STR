import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { serverErrorText } from '@/lib/server-error';

import { Text } from './text';

/** The server's own words are for passing on, not for reading: a few lines at most. */
const DETAIL_LINES = 3;

export interface FailureTextProps {
  /** The failure as it came: a refusal the app knows is translated, anything else is not. */
  error: unknown;
}

/**
 * A move that failed, said where it was made — next to the button she
 * retries with. The reason in her language (`serverErrorText`), and for an
 * unknown failure the server's own words small under it, so she can forward
 * them to the manager; the raw message is never shown on its own (CLAUDE.md).
 * A screen that could not load at all is `ErrorState`, a refresh that failed
 * over what is still shown `ErrorBanner`.
 */
export function FailureText({ error }: FailureTextProps) {
  const failure = serverErrorText(error);

  return (
    <View accessibilityLiveRegion="polite" style={styles.failure}>
      <Text tone="danger" align="center">
        {failure.text}
      </Text>
      {failure.detail !== null ? (
        <Text
          variant="caption"
          tone="secondary"
          align="center"
          numberOfLines={DETAIL_LINES}
          selectable
        >
          {failure.detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  failure: { gap: Spacing.xs },
});
