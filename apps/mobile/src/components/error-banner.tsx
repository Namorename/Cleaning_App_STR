import { StyleSheet, View } from 'react-native';

import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import { Text } from './text';

/** The server's own words are for passing on, not for reading: a few lines at most. */
const DETAIL_LINES = 3;

export interface ErrorBannerProps {
  /** What happened, from the screen: the lists pass `common.refreshFailed`. */
  title: string;
  error: unknown;
}

/**
 * A failure said above content that is still worth showing — the list from
 * the last time it loaded — instead of replacing it with an error screen. The
 * screen's sentence, the reason in her language, and for an unknown failure
 * the server's words small under it (CLAUDE.md).
 */
export function ErrorBanner({ title, error }: ErrorBannerProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const ink = theme.tone.urgent.fg;
  const failure = serverErrorText(error);

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Text accessibilityRole="alert" color={ink} weight={700}>
        {title}
      </Text>
      <Text variant="caption" color={ink}>
        {failure.text}
      </Text>
      {failure.detail !== null ? (
        <Text variant="caption" tone="secondary" numberOfLines={DETAIL_LINES} selectable>
          {failure.detail}
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    banner: {
      gap: Spacing.xs,
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      marginBottom: Spacing.md,
      backgroundColor: theme.tone.urgent.bg,
    },
  });
