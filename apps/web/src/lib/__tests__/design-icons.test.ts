import { ICONS } from '@str-ops/shared';
import { icons } from 'lucide-react';
import { describe, expect, test } from 'vitest';

/**
 * The icon map names Lucide icons by their canonical kebab-case names (the
 * owner's decision 7: Lucide in both apps). A name Lucide does not have would
 * render nothing — in the panel at once, and in the phone only after its build
 * brings `react-native-svg` (5.3), when nobody is looking at the panel's map
 * any more. An alias renders today and disappears in a later major version:
 * Lucide 1.x already made `trash-2` an alias of `trash`. The panel ships
 * `lucide-react`, whose `icons` lists canonical icons only, so the names are
 * checked against it here; the phone checks them against
 * `lucide-react-native` when it gets the package.
 */

/** `user-round-check` → `UserRoundCheck`, the name Lucide exports the component under. */
function componentName(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

describe('the icon map', () => {
  test.each(Object.entries(ICONS))('%s → %s is a canonical Lucide icon', (_meaning, name) => {
    expect(Object.hasOwn(icons, componentName(name))).toBe(true);
  });
});
