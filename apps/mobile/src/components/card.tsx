import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

export interface CardProps {
  children: ReactNode;
  /** Makes the whole card one button; its parts are then read as one. */
  onPress?: () => void;
  /** What the reader hears for a card that is a button: say the facts in one line. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Layout only — a margin, a flex. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A card: the surface, rounded 20, on a soft shadow — direction A draws cards
 * without a frame (decisions §1). A card with an action is one button; keep a
 * second action beside it, not inside, or the reader cannot reach it.
 */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: CardProps) {
  const styles = useThemedStyles(createStyles);

  if (onPress === undefined) {
    return (
      <View testID={testID} style={[styles.card, style]}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.card,
      borderRadius: Radius.card,
      padding: Spacing.lg,
      gap: Spacing.sm,
      boxShadow: theme.shadow,
    },
    pressed: { backgroundColor: theme.surfaceAlt },
  });
