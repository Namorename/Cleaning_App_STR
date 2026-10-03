import { THEME_COLORS } from '@str-ops/shared';
import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View, type ColorValue } from 'react-native';

import TabsLayout from '@/app/(tabs)/_layout';

/**
 * Each tab draws the icon of its meaning (`ICONS`, the same picture as the
 * panel's menu), in the navigator's tint and hidden behind the tab's title.
 */

interface TabOptions {
  title?: string;
  tabBarIcon?: (props: { focused: boolean; color: ColorValue; size: number }) => ReactNode;
}

/** What the layout gave each tab, by the tab's route name. */
const mockScreens = new Map<string, TabOptions>();

jest.mock('expo-router', () => {
  // The tab navigator reduced to what is asserted here: the options of each tab.
  function Tabs({ children }: { children: ReactNode }) {
    return children;
  }
  Tabs.Screen = function Screen({ name, options }: { name: string; options: TabOptions }) {
    mockScreens.set(name, options);
    return null;
  };
  return {
    Tabs,
    Redirect: function Redirect() {
      return null;
    },
    router: { push: jest.fn() },
  };
});

jest.mock('expo-symbols', () => ({ SymbolView: () => null }));

// The layout's push wiring has its own tests (features/push/__tests__/hooks.test.tsx).
jest.mock('@/features/push/hooks', () => ({
  usePushTaps: jest.fn(),
  usePermissionPrompt: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', isLoading: false }),
  signOut: jest.fn(),
}));

/** The tint the navigator hands its icons in this test. */
const TINT = THEME_COLORS.light.primary;

beforeEach(() => {
  mockScreens.clear();
});

test.each([
  ['index', 'house'],
  ['queue', 'inbox'],
  ['problems', 'clipboard-list'],
  ['supplies', 'package'],
])('the tab %s draws %s in the navigator’s tint, hidden behind its title', async (tab, glyph) => {
  // Arrange: the layout hands each tab its options.
  await render(<TabsLayout />);
  const drawIcon = mockScreens.get(tab)?.tabBarIcon;
  expect(drawIcon).toBeDefined();

  // Act: the navigator draws the tab's icon, the way it calls it.
  await render(<View testID="tab">{drawIcon?.({ focused: false, color: TINT, size: 25 })}</View>);

  // Assert
  const [box] = screen.getByTestId('tab', { includeHiddenElements: true }).children;
  if (box === undefined || typeof box === 'string') {
    throw new Error(`the tab ${tab} draws no icon`);
  }
  const [drawing] = box.children;
  if (drawing === undefined || typeof drawing === 'string') {
    throw new Error(`the icon of the tab ${tab} holds no drawing`);
  }
  expect(drawing.props).toMatchObject({
    stroke: TINT,
    className: expect.stringContaining(`lucide-${glyph}`),
  });
  expect(isHiddenFromAccessibility(box)).toBe(true);
});
