import {
  Image,
  StyleSheet,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
} from 'react-native';

import type { ThemeName } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import markDark from '../../assets/brand/logo-dark.png';
import markLight from '../../assets/brand/logo-light.png';

/** The mark's side, dp: the size the page draws it above the sign-in heading. */
const MARK_SIZE = 72;

/**
 * Each theme's own drawing (docs/redesign-plan.md §6.2), rendered from the
 * panel's `logo-mark-light.svg` and `logo-mark-dark.svg`. The dark one is
 * lighter, its doorway cut out to the screen behind.
 */
const MARK: Readonly<Record<ThemeName, ImageSourcePropType>> = {
  light: markLight,
  dark: markDark,
};

export interface BrandMarkProps {
  /** Layout only — a margin, an alignment. */
  style?: StyleProp<ImageStyle>;
  testID?: string;
}

/**
 * The company's mark, a picture in the bundle — until the owner's logo, the
 * Apricot sketch. Decoration: the heading beside it names the screen, so the
 * reader skips it.
 */
export function BrandMark({ style, testID }: BrandMarkProps) {
  const theme = useTheme();

  return (
    <Image
      testID={testID}
      source={MARK[theme.scheme]}
      style={[styles.mark, style]}
      resizeMode="contain"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  mark: { width: MARK_SIZE, height: MARK_SIZE },
});
