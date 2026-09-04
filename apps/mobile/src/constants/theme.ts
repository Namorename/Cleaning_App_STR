/**
 * The app's colour palette, defined once for both schemes.
 *
 * Every colour the app paints lives here. Nothing hardcodes a hex value in a
 * StyleSheet: a value written into a component exists in one theme only, and
 * the one that was missing from the other theme is exactly how the first build
 * ended up printing black text on a black background.
 *
 * Contrast ratios are verified by `__tests__/theme.test.ts` — change a value
 * here and the test says whether it is still readable.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    background: '#F4F5F7',
    card: '#FFFFFF',
    text: '#11181C',
    textSecondary: '#5B6169',
    /** Outline of an input or other control the user has to find. */
    border: '#7A828C',
    /** Decorative edge of a card; deliberately quieter than `border`. */
    divider: '#DDE1E6',
    primary: '#0B62C4',
    onPrimary: '#FFFFFF',
    danger: '#B3261E',
    urgentText: '#8C1D18',
    urgentSurface: '#FBE9E7',
    calmText: '#0F5132',
    calmSurface: '#E4F2EA',
  },
  dark: {
    background: '#0E1113',
    card: '#1A1D21',
    text: '#ECEDEE',
    textSecondary: '#A3AAB3',
    border: '#767D86',
    divider: '#2B3038',
    primary: '#4DA3FF',
    // Dark ink on a light blue button: white on this blue is only 2.6:1.
    onPrimary: '#082038',
    danger: '#FF9E96',
    urgentText: '#FFB4AB',
    urgentSurface: '#3B1512',
    calmText: '#7EE2A8',
    calmSurface: '#12291C',
  },
} as const;

export type ThemeName = keyof typeof Colors;
export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type Theme = (typeof Colors)[ThemeName];

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * Design tokens. Spacing and radii live here so screens never hardcode
 * numbers — the cleaner app is used one-handed, often in a hurry, and the
 * touch targets below are the accessibility minimum, not a suggestion.
 */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const Radius = {
  md: 10,
  lg: 14,
} as const;

export const FontSize = {
  caption: 13,
  body: 15,
  title: 17,
  heading: 22,
} as const;

/** iOS asks for 44pt, Android for 48dp; take the larger and stop thinking. */
export const MIN_TOUCH_TARGET = 48;
