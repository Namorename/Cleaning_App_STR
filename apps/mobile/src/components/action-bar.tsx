import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { useScreenEdgePadding } from './bottom-inset';

export interface ActionBarProps {
  children: ReactNode;
  /**
   * Nothing under it but the edge of the screen — a form, not a tab: it clears
   * the system's bar there (the navigation bar, the home indicator). Above the
   * tab bar it does not; the tab bar has.
   */
  isAtScreenEdge?: boolean;
  testID?: string;
}

/**
 * The strip a screen's main button is pinned in: under what scrolls, full
 * width less the screen margins, on the screen's background with a hairline
 * above it.
 *
 * Laid below the content rather than floated over it, so the last card of a
 * list or the last field of a form scrolls up to its edge instead of under
 * the button — and a button grown by a large system font pushes the content
 * up instead of covering more of it.
 */
export function ActionBar({ children, isAtScreenEdge = false, testID }: ActionBarProps) {
  const styles = useThemedStyles(createStyles);
  const edge = useScreenEdgePadding(Spacing.md);

  return (
    <View testID={testID} style={[styles.bar, isAtScreenEdge && edge]}>
      {children}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    bar: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.md,
      gap: Spacing.sm,
      backgroundColor: theme.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
  });
