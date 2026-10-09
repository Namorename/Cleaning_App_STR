import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/** One way of the pulse, and how far it fades. */
const PULSE_MS = 700;
const PULSE_LOW = 0.45;

export interface SkeletonGroupProps {
  /** What is loading, said to the reader; `common.loading` by default. */
  label?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The shape of what is coming, while it loads. The whole group is one element
 * for a screen reader — "loading", busy — and its blocks are not read at all;
 * it pulses as one, and holds still when the phone asks for less motion.
 */
export function SkeletonGroup({ label, children, style }: SkeletonGroupProps) {
  const { t } = useTranslation();
  const isReduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (isReduced) {
      opacity.setValue(1);
      return undefined;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: PULSE_LOW, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isReduced, opacity]);

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('common.loading')}
      accessibilityState={{ busy: true }}
      // Said when it appears, as the spinner it replaced on the lists was.
      accessibilityLiveRegion="polite"
      style={[styles.group, { opacity }, style]}
    >
      {children}
    </Animated.View>
  );
}

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** One block of a skeleton: a line of text, a chip, a card. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = Radius.md,
  style,
  testID,
}: SkeletonProps) {
  const themed = useThemedStyles(createStyles);

  return (
    <View
      testID={testID}
      style={[themed.block, { width, height, borderRadius: radius }, style]}
    />
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.sm },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    block: { backgroundColor: theme.surfaceAlt },
  });
