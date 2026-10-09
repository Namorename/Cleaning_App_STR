import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { Text } from './text';

export interface LoadingStateProps {
  /** What it waits for, in the words of the screen to come: «Входим…». */
  label: string;
}

/**
 * A whole screen waiting on something that has no shape to show yet — the
 * stored session on a cold start. A screen whose content is coming draws its
 * shape instead (`SkeletonGroup`). One element for a screen reader:
 * «loading», busy, in these words; on screen the spinner and the same words,
 * centred on the screen's background.
 */
export function LoadingState({ label }: LoadingStateProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      style={styles.centered}
    >
      <ActivityIndicator testID="loading-spinner" color={theme.textSecondary} />
      <Text tone="secondary" align="center">
        {label}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
      backgroundColor: theme.background,
    },
  });
