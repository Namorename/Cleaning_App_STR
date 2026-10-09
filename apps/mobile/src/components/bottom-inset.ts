import { useContext, useMemo } from 'react';
import { Platform, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

/**
 * How far what the system draws over the bottom of the screen reaches up it:
 * Android's three-button navigation bar (48 dp), its gesture bar (16–24 dp),
 * an iPhone's home indicator (34 pt).
 *
 * The app is drawn edge to edge — Android 15+ does so whatever the app asks,
 * and Expo asks for it on every version — so the system lays that bar over
 * the bottom of every screen. Whatever sits on the bottom edge rises by this
 * itself: the tab bar, a screen's action bar, a sheet, the chat's box, the
 * end of a screen that scrolls. Nothing above the tab bar does; the tab bar
 * has.
 *
 * Read from the root's SafeAreaProvider. Outside one — the root's error
 * screen, drawn above it, or a test — there is no inset and the edge keeps
 * only its own margin.
 */
export function useBottomInset(): number {
  return useContext(SafeAreaInsetsContext)?.bottom ?? 0;
}

export interface ScreenEdgeOptions {
  /**
   * A ScrollView drawn with `contentInsetAdjustmentBehavior="automatic"`: on
   * iOS UIKit already insets its content by the home indicator, and the
   * padding would add it twice. Android has nothing of the kind.
   */
  isAdjustedOnIos?: boolean;
}

/**
 * The bottom padding of what ends at the screen's bottom edge — a bar, or the
 * content of a screen that scrolls to it: its own margin, then the inset, so
 * the last button scrolled to the end stops clear of the system's bar with
 * the same gap above it as with no bar at all.
 */
export function useScreenEdgePadding(
  margin: number,
  { isAdjustedOnIos = false }: ScreenEdgeOptions = {},
): ViewStyle {
  const inset = useBottomInset();
  const rise = isAdjustedOnIos && Platform.OS === 'ios' ? 0 : inset;
  return useMemo(() => ({ paddingBottom: margin + rise }), [margin, rise]);
}

/**
 * `keyboardVerticalOffset` for a KeyboardAvoidingView whose last child pads
 * itself by the inset.
 *
 * The view pads by all the keyboard covers of it, measured to the bottom of
 * the screen, and that includes the system's bar under the keys; its bottom
 * bar then rises by the inset again, and would float that high above the
 * keys. The offset takes it back once. `headerHeight` is the header above the
 * view, whose height the keyboard's top is measured past; none for a screen
 * or a sheet without one.
 */
export function useKeyboardOffset(headerHeight = 0): number {
  return headerHeight - useBottomInset();
}
