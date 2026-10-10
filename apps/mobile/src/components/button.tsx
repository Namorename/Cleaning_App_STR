import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { BUTTON_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { Text } from './text';

/**
 * - `primary` — the main button of a screen: the sun-proof `cta` fill;
 * - `secondary` — tonal: a primary tint, no frame;
 * - `outline` — a frame in the primary colour;
 * - `destructive` — tonal in the urgent tone, the label in `danger`; never a
 *   solid red fill like the main button.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  isDisabled?: boolean;
  /** Working on it: the label stays, a spinner joins it, a second tap does nothing. */
  isBusy?: boolean;
  /** Read instead of the label when the label alone does not say what it acts on. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Beside the label: where an icon goes once the icons arrive with build 1.2.0. */
  left?: ReactNode;
  right?: ReactNode;
  /** Layout only — a margin, a flex. */
  style?: StyleProp<ViewStyle>;
}

/** A button: 56 dp for a gloved finger (owner's decision 5), a pill. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  isDisabled = false,
  isBusy = false,
  accessibilityLabel,
  accessibilityHint,
  left,
  right,
  style,
}: ButtonProps) {
  const styles = useThemedStyles(createStyles);
  const isInactive = isDisabled || isBusy;
  const ink = isDisabled ? styles.disabledInk : styles.ink[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isInactive, busy: isBusy }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isDisabled ? styles.disabledBox[variant] : styles.box[variant],
        pressed && styles.pressedBox[variant],
        style,
      ]}
    >
      {isBusy ? <ActivityIndicator color={ink} /> : left}
      <Text variant="button" color={ink} align="center" style={styles.label}>
        {label}
      </Text>
      {right}
    </Pressable>
  );
}

/** The width of every frame a button draws: the outline's, and the inactive one. */
const FRAME_WIDTH = 2;

const createStyles = (theme: Theme) => {
  /**
   * Inactive: a quiet fill, and a frame in `border` — the fill alone is
   * 1.04:1 against the light screen and the button vanished (owner,
   * 2026-10-09); the frame is 3:1 or more against the screen and a card in
   * both themes (WCAG 1.4.11, button.test.tsx).
   */
  const inactive: ViewStyle = {
    backgroundColor: theme.surfaceAlt,
    borderWidth: FRAME_WIDTH,
    borderColor: theme.border,
  };
  /**
   * A kind that has no frame when active gives the inactive one out of its
   * padding: the box keeps its size when the button turns active, at any
   * font size.
   */
  const framedInactive: ViewStyle = {
    ...inactive,
    paddingHorizontal: Spacing.xl - FRAME_WIDTH,
    paddingVertical: Spacing.sm - FRAME_WIDTH,
  };

  return {
    ...StyleSheet.create({
      base: {
        minHeight: BUTTON_HEIGHT,
        borderRadius: Radius.pill,
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
      },
      label: { flexShrink: 1 },
    }),
    box: {
      primary: { backgroundColor: theme.cta },
      secondary: { backgroundColor: theme.secondary },
      outline: {
        backgroundColor: 'transparent',
        borderWidth: FRAME_WIDTH,
        borderColor: theme.primary,
      },
      destructive: { backgroundColor: theme.tone.urgent.bg },
    } satisfies Readonly<Record<ButtonVariant, ViewStyle>>,
    disabledBox: {
      primary: framedInactive,
      secondary: framedInactive,
      outline: inactive,
      destructive: framedInactive,
    } satisfies Readonly<Record<ButtonVariant, ViewStyle>>,
    pressedBox: {
      primary: { backgroundColor: theme.ctaPressed },
      secondary: { opacity: 0.85 },
      outline: { backgroundColor: theme.secondary },
      destructive: { opacity: 0.85 },
    } satisfies Readonly<Record<ButtonVariant, ViewStyle>>,
    ink: {
      primary: theme.onCta,
      secondary: theme.onSecondary,
      outline: theme.primary,
      destructive: theme.danger,
    } satisfies Readonly<Record<ButtonVariant, string>>,
    disabledInk: theme.textMuted,
  };
};
