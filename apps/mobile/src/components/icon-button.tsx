import type { IconMeaning } from '@str-ops/shared';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type AccessibilityValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { BUTTON_HEIGHT, MIN_TOUCH_TARGET, Radius, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { Icon } from './icon';

/**
 * - `primary` — the screen's main move, in the sun-proof `cta` fill like the
 *   main `Button`;
 * - `plain` — a tool beside a field: the icon in the primary colour, no fill.
 */
export type IconButtonVariant = 'primary' | 'plain';

/** `regular` — any target (48 dp); `large` — the main button (56 dp, decision 5). */
export type IconButtonSize = 'regular' | 'large';

export interface IconButtonProps {
  /** What the picture means (`ICONS`). */
  icon: IconMeaning;
  /** The button has no words on it: this is what the reader says. Required. */
  accessibilityLabel: string;
  onPress: () => void;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  isDisabled?: boolean;
  /** Working on it: a spinner in place of the picture, a second tap does nothing. */
  isBusy?: boolean;
  accessibilityHint?: string;
  /** Read after the label: how many photos are chosen, say. */
  accessibilityValue?: AccessibilityValue;
  /** Layout only — a margin. */
  style?: StyleProp<ViewStyle>;
}

/** A round button that is only an icon (Lucide, decision 7), on a full touch target. */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'plain',
  size = 'regular',
  isDisabled = false,
  isBusy = false,
  accessibilityHint,
  accessibilityValue,
  style,
}: IconButtonProps) {
  const styles = useThemedStyles(createStyles);
  const isInactive = isDisabled || isBusy;
  const ink = isDisabled ? styles.disabledInk : styles.ink[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityValue={accessibilityValue}
      accessibilityState={{ disabled: isInactive, busy: isBusy }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        SIDE[size],
        isDisabled ? styles.disabledBox[variant] : styles.box[variant],
        pressed && styles.pressedBox[variant],
        style,
      ]}
    >
      {isBusy ? <ActivityIndicator color={ink} /> : <Icon name={icon} color={ink} />}
    </Pressable>
  );
}

/** Sizes only: the target is square, the icon centred in it. */
const SIDE = StyleSheet.create({
  regular: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET },
  large: { width: BUTTON_HEIGHT, height: BUTTON_HEIGHT },
} satisfies Readonly<Record<IconButtonSize, ViewStyle>>);

/** The inactive frame's width, as `Button` draws it; inside the box, which `SIDE` sizes. */
const FRAME_WIDTH = 2;

const createStyles = (theme: Theme) => ({
  ...StyleSheet.create({
    base: {
      borderRadius: Radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
  box: {
    primary: { backgroundColor: theme.cta },
    plain: { backgroundColor: 'transparent' },
  } satisfies Readonly<Record<IconButtonVariant, ViewStyle>>,
  /**
   * Inactive, a primary one keeps a frame in `border`: the quiet fill alone
   * is 1.04:1 against the light screen, and the chat's send button vanished
   * while the box was empty — as `Button` did (owner, 2026-10-09). The frame
   * is 3:1 or more against the screen and a card in both themes (WCAG 1.4.11,
   * icon-button.test.tsx).
   */
  disabledBox: {
    primary: {
      backgroundColor: theme.surfaceAlt,
      borderWidth: FRAME_WIDTH,
      borderColor: theme.border,
    },
    plain: { backgroundColor: 'transparent' },
  } satisfies Readonly<Record<IconButtonVariant, ViewStyle>>,
  pressedBox: {
    primary: { backgroundColor: theme.ctaPressed },
    plain: { backgroundColor: theme.secondary },
  } satisfies Readonly<Record<IconButtonVariant, ViewStyle>>,
  ink: {
    primary: theme.onCta,
    plain: theme.primary,
  } satisfies Readonly<Record<IconButtonVariant, string>>,
  disabledInk: theme.textMuted,
});
