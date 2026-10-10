import { screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

/**
 * The bottom insets a phone gives the app, in dp: none (an old phone, an
 * iPhone with a home button), a gesture bar, and Android's three-button
 * navigation bar — the one the owner found hiding the bottom of the screens
 * (block 3, 2026-10-10).
 */
export const BOTTOM_INSETS = [0, 24, 48] as const;

/** A portrait phone, 360 × 800 dp, a status bar at the top and the given inset at the bottom. */
export function metricsWithBottom(bottom: number): Metrics {
  return {
    frame: { x: 0, y: 0, width: 360, height: 800 },
    insets: { top: 24, right: 0, bottom, left: 0 },
  };
}

/** `children` inside the provider the root layout draws every screen in, with that bottom inset. */
export function withBottomInset(bottom: number, children: ReactNode): ReactElement {
  return <SafeAreaProvider initialMetrics={metricsWithBottom(bottom)}>{children}</SafeAreaProvider>;
}

/** The padding a style leaves at its bottom: `paddingBottom`, else `paddingVertical`, else `padding`. */
export function bottomPaddingOf(style: unknown): number {
  const flat: ViewStyle = StyleSheet.flatten(style as ViewStyle) ?? {};
  const value = flat.paddingBottom ?? flat.paddingVertical ?? flat.padding ?? 0;
  return typeof value === 'number' ? value : Number.NaN;
}

/**
 * The bottom padding of the content of the screen's own scroll view — the
 * outermost vertical one, not a strip of photos inside it: how far the last
 * thing scrolled to the end stops above the screen's bottom edge.
 */
export function scrollEndPadding(): number {
  const [scroll] = screen.container.queryAll(
    (node) => node.type === 'RCTScrollView' && node.props.horizontal !== true,
  );
  if (scroll === undefined) {
    throw new Error('The screen has no vertical scroll view');
  }
  return bottomPaddingOf(scroll.props.contentContainerStyle);
}
