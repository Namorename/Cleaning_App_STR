import { useEffect, useEffectEvent, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from 'react-native';

import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { useBottomInset } from './bottom-inset';
import { Text } from './text';

/** How long a toast stays: long enough to read a sentence twice. */
export const TOAST_DURATION_MS = 4_000;
const FADE_MS = 200;

export interface ToastProps {
  /** The sentence to show; nothing is drawn while it is null. */
  message: string | null;
  /** Called when the toast has been shown long enough: set the message back to null. */
  onHide: () => void;
  durationMs?: number;
}

/**
 * A short sentence over the bottom of the screen that goes by itself — "saved",
 * not a question. Said to a screen reader as it appears (a live region on
 * Android, an announcement on iOS, where live regions do not exist); fades in,
 * or appears at once when the phone asks for less motion. Drawn in the inverse
 * of the page — text colour as its fill — so it reads on any screen.
 */
export function Toast({ message, onHide, durationMs = TOAST_DURATION_MS }: ToastProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const isReduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0));
  // Above the system's bar, which lies over the bottom of the screen.
  const bottomInset = useBottomInset();
  const hide = useEffectEvent(onHide);

  useEffect(() => {
    if (message === null) {
      return undefined;
    }
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(message);
    }
    if (isReduced) {
      opacity.setValue(1);
    } else {
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
    }
    const timer = setTimeout(() => hide(), durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs, isReduced, opacity]);

  if (message === null) {
    return null;
  }

  return (
    <View
      testID="toast"
      pointerEvents="box-none"
      style={[styles.host, { bottom: Spacing.lg + bottomInset }]}
    >
      <Animated.View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.toast, { opacity }]}
      >
        <Text color={theme.background}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    host: {
      position: 'absolute',
      left: Spacing.lg,
      right: Spacing.lg,
      alignItems: 'center',
    },
    toast: {
      backgroundColor: theme.text,
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      boxShadow: theme.shadow,
    },
  });
