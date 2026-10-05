import { useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

export interface ActionBarProps {
  children: ReactNode;
  /**
   * Nothing under it but the edge of the screen — a form, not a tab: it clears
   * the home indicator. Above the tab bar it does not; the tab bar has.
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
  // Inside the root's SafeAreaProvider the bar clears the home indicator;
  // without one (a test) it simply sits on the edge.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const edge = useMemo(() => ({ paddingBottom: Spacing.md + bottomInset }), [bottomInset]);

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
