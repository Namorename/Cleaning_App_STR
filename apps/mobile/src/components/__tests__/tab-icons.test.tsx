import { THEME_COLORS } from '@str-ops/shared';
import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View, type ColorValue } from 'react-native';

import TabsLayout from '@/app/(tabs)/_layout';
import { renderTabBar } from '@/components/tab-bar';

/**
 * The navigator draws the phone's own tab bar, and each tab the icon of its
 * meaning (`ICONS`, the same picture as the panel's menu) in the bar's tint,
 * filled while the tab is active, hidden behind the tab's title.
 */

interface TabOptions {
  title?: string;
  tabBarIcon?: (props: { focused: boolean; color: ColorValue; size: number }) => ReactNode;
}

/** What the layout gave each tab, by the tab's route name. */
const mockScreens = new Map<string, TabOptions>();

/** What the layout gave the navigator itself. */
const mockNavigator: { tabBar?: unknown } = {};

jest.mock('expo-router', () => {
  // The tab navigator reduced to what is asserted here: its tab bar and the
  // options of each tab.
  function Tabs({ children, tabBar }: { children: ReactNode; tabBar?: unknown }) {
    mockNavigator.tabBar = tabBar;
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

/** The tints the bar hands its icons: an inactive tab's, and the active tab's on its pill. */
const INACTIVE = THEME_COLORS.light.textMuted;
const ACTIVE = THEME_COLORS.light.onAccent;

beforeEach(() => {
  mockScreens.clear();
  delete mockNavigator.tabBar;
});

test('the navigator draws the phone’s own tab bar', async () => {
  await render(<TabsLayout />);

  expect(mockNavigator.tabBar).toBe(renderTabBar);
});

test.each([
  ['index', 'house'],
  ['queue', 'inbox'],
  ['problems', 'clipboard-list'],
  ['supplies', 'package'],
])('the tab %s draws %s in the bar’s tint, hidden behind its title', async (tab, glyph) => {
  // Arrange: the layout hands each tab its options.
  await render(<TabsLayout />);
  const drawIcon = mockScreens.get(tab)?.tabBarIcon;
  expect(drawIcon).toBeDefined();

  // Act: the bar draws the tab's icon, inactive and then active.
  await render(
    <>
      <View testID="inactive">{drawIcon?.({ focused: false, color: INACTIVE, size: 24 })}</View>
      <View testID="active">{drawIcon?.({ focused: true, color: ACTIVE, size: 24 })}</View>
    </>,
  );

  // Assert
  const inactive = iconIn('inactive');
  expect(inactive.drawing).toMatchObject({
    stroke: INACTIVE,
    fill: 'none',
    className: expect.stringContaining(`lucide-${glyph}`),
  });
  expect(isHiddenFromAccessibility(inactive.box)).toBe(true);
  expect(iconIn('active').drawing).toMatchObject({
    stroke: ACTIVE,
    fill: ACTIVE,
    className: expect.stringContaining(`lucide-${glyph}`),
  });
});

/** The icon's box inside a holder, and what Lucide handed its drawing. */
function iconIn(holder: string) {
  const [box] = screen.getByTestId(holder, { includeHiddenElements: true }).children;
  if (box === undefined || typeof box === 'string') {
    throw new Error(`${holder} draws no icon`);
  }
  const [drawing] = box.children;
  if (drawing === undefined || typeof drawing === 'string') {
    throw new Error(`the icon in ${holder} holds no drawing`);
  }
  return { box, drawing: drawing.props as Readonly<Record<string, unknown>> };
}
