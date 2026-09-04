import { useMemo } from 'react';

import type { Theme } from '@/constants/theme';

import { useTheme } from './use-theme';

/**
 * Build a StyleSheet from the active theme, once per theme.
 *
 * Styles that depend on colour cannot live at module scope any more, and
 * rebuilding them inside the render body would allocate a new object on every
 * frame — the thing the RN styling rules warn about on list rows. Pass a
 * module-level factory so its identity is stable and the memo actually holds.
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();

  return useMemo(() => factory(theme), [factory, theme]);
}
