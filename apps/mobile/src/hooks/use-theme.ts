/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors, type Theme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The active palette.
 *
 * Anything that is not explicitly dark is treated as light: the scheme comes
 * back as null before hydration on web and as 'unspecified' on Android when
 * the user has made no choice, and both must land on a readable default rather
 * than on undefined.
 */
export function useTheme(): Theme {
  const scheme = useColorScheme();

  return Colors[scheme === 'dark' ? 'dark' : 'light'];
}
