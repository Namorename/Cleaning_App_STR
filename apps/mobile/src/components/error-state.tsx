import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { serverErrorText } from '@/lib/server-error';

import { Button } from './button';
import { Text } from './text';

/** The server's own words are for passing on, not for reading: a few lines at most. */
const DETAIL_LINES = 3;

export interface ErrorStateProps {
  /** The failure as it came: a refusal the app knows is translated, anything else is not. */
  error: unknown;
  /** What did not happen, from the screen: «Не удалось загрузить уборки». */
  title?: string;
  onRetry?: () => void;
}

/**
 * A screen that could not show what it is for. The reason in her language
 * (`serverErrorText`: a known refusal, or the general sentence), and for an
 * unknown failure the server's own English small under it, so she can forward
 * it to the manager — the raw message is never shown on its own (CLAUDE.md).
 */
export function ErrorState({ error, title, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  const failure = serverErrorText(error);

  return (
    <View style={styles.failure} accessibilityLiveRegion="polite">
      {title !== undefined ? (
        <Text variant="title" align="center">
          {title}
        </Text>
      ) : null}
      <Text accessibilityRole="alert" align="center">
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
      {onRetry !== undefined ? (
        <Button
          variant="secondary"
          label={t('common.retry')}
          onPress={onRetry}
          style={styles.retry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  failure: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.xl,
  },
  retry: { marginTop: Spacing.sm },
});
