import { THEME_COLORS } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { withLayoutContext } from 'expo-router/build/layouts/withLayoutContext';
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/tabs';
import { Platform, StyleSheet, type ColorValue, type TextStyle, type ViewStyle } from 'react-native';

import { FontSize, IconSize, MIN_TOUCH_TARGET, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BOTTOM_INSETS } from '@/testing/insets';

import { TabBar } from '../tab-bar';

/**
 * The phone's own tab bar (decisions.md §2, «Вход и вкладки», variant 1): each
 * tab a pill holding its icon, the title under it. The active tab is told by
 * more than the honey colour (plan §3): its pill is filled, its icon filled,
 * its title heavier and in the text colour. A press does what the stock bar
 * of the navigator did, so `tabPress` listeners — a list scrolling to its top
 * — keep working.
 */

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

// Where expo-router builds its tab navigator (build/layouts/TabsClient.js) it
// hands over the function that turns a screen's `href` into tab-bar options.
// Caught here, so the hidden screen below is what expo-router itself makes of
// `href: null`, not a copy of it.
jest.mock('expo-router/build/layouts/withLayoutContext', () => ({
  withLayoutContext: jest.fn(() =>
    Object.assign(() => null, { Screen: () => null, Protected: () => null }),
  ),
}));
const processScreens = jest.mocked(withLayoutContext).mock.calls[0]?.[1];

const light = THEME_COLORS.light;
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };

interface FakeTab {
  name: string;
  title: string;
  /** What else the screen's options carry. */
  options?: Readonly<Record<string, unknown>>;
}

const MY: FakeTab = { name: 'index', title: 'Мои уборки' };
const QUEUE: FakeTab = { name: 'queue', title: 'Свободные' };
const PROBLEMS: FakeTab = { name: 'problems', title: 'Задания' };
const SUPPLIES: FakeTab = { name: 'supplies', title: 'Расходники' };
const CLEANER_TABS = [MY, QUEUE, PROBLEMS, SUPPLIES];

/**
 * A screen declared with `href: null`, as expo-router hands it to a tab bar.
 * The technician's tabs will hide the cleaner's this way.
 */
function hiddenByHref(): FakeTab {
  if (processScreens === undefined) {
    throw new Error('expo-router built its tab navigator without a screen processor');
  }
  const declared = { title: 'Мои работы', href: null };
  const [screen] = processScreens([{ name: 'jobs', options: declared }]);
  return {
    name: 'jobs',
    title: declared.title,
    options: screen?.options as Readonly<Record<string, unknown>>,
  };
}

type DrawIcon = (props: { focused: boolean; color: ColorValue; size: number }) => null;

const emit = jest.fn((_event: { type: string; target?: string; canPreventDefault?: boolean }) => ({
  defaultPrevented: false,
}));
const navigate = jest.fn();
let icons = new Map<string, jest.Mock<ReturnType<DrawIcon>, Parameters<DrawIcon>>>();

/** What the navigator hands its tab bar: the routes, each screen's options, itself. */
function barProps(tabs: readonly FakeTab[], focused: string): BottomTabBarProps {
  icons = new Map(tabs.map(({ name }) => [name, jest.fn<null, Parameters<DrawIcon>>(() => null)]));
  const routes = tabs.map(({ name }) => ({ key: `${name}-key`, name, params: undefined }));
  const descriptors = Object.fromEntries(
    tabs.map(({ name, title, options }) => [
      `${name}-key`,
      { options: { title, tabBarIcon: icons.get(name), ...options } },
    ]),
  );
  return {
    state: {
      type: 'tab',
      key: 'tabs-key',
      index: routes.findIndex((route) => route.name === focused),
      routeNames: tabs.map(({ name }) => name),
      routes,
      history: [],
      stale: false,
      preloadedRouteKeys: [],
    },
    descriptors,
    navigation: { emit, navigate },
    insets: INSETS,
  } as unknown as BottomTabBarProps;
}

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) ?? {};
}

/**
 * The bar itself. A tablist is not an element the reader stops on — each tab
 * is — so it is found by its id, not by its role.
 */
function bar() {
  return screen.getByTestId('tab-bar');
}

function tab(title: string) {
  return screen.getByRole('tab', { name: title });
}

function pillOf(title: string): ViewStyle {
  return styleOf(within(tab(title)).getByTestId('tab-pill'));
}

function titleOf(title: string) {
  return within(tab(title)).getByText(title);
}

/**
 * Android unless a test says otherwise: there a tab is a tab. VoiceOver knows
 * no tab role, and iOS gets its own block below.
 */
let os: jest.ReplaceProperty<typeof Platform.OS>;

beforeEach(() => {
  jest.clearAllMocks();
  scheme.mockReturnValue('light');
  emit.mockReturnValue({ defaultPrevented: false });
  os = jest.replaceProperty(Platform, 'OS', 'android');
});

afterEach(() => {
  os.restore();
});

describe('what it draws', () => {
  test('a tab for each of her four screens, named by its title, the active one selected', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'queue')} />);

    expect(bar().props.accessibilityRole).toBe('tablist');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Свободные', selected: true })).toBeTruthy();
    for (const other of [MY, PROBLEMS, SUPPLIES]) {
      expect(screen.getByRole('tab', { name: other.title, selected: false })).toBeTruthy();
    }
  });

  test('a screen’s own label is its title, its own reader name and test id are the tab’s', async () => {
    const queue: FakeTab = {
      ...QUEUE,
      options: {
        tabBarLabel: 'Свободно',
        tabBarAccessibilityLabel: 'Свободные уборки',
        tabBarButtonTestID: 'queue-tab',
      },
    };

    await render(<TabBar {...barProps([MY, queue], 'index')} />);

    const named = screen.getByRole('tab', { name: 'Свободные уборки' });
    expect(within(named).getByText('Свободно')).toBeTruthy();
    expect(screen.getByTestId('queue-tab')).toBe(named);
  });

  test('a screen the navigator hides (expo-router’s href: null) gets no tab', async () => {
    await render(
      <TabBar {...barProps([MY, hiddenByHref(), QUEUE, PROBLEMS, SUPPLIES], 'queue')} />,
    );

    expect(screen.queryByText('Мои работы')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Мои работы' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Свободные', selected: true })).toBeTruthy();
    expect(icons.get('jobs')).not.toHaveBeenCalled();
  });

  test('the active tab: its icon filled in onAccent on the honey pill, its title in the text colour', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    expect(icons.get('index')).toHaveBeenLastCalledWith({
      focused: true,
      color: light.onAccent,
      size: IconSize.regular,
    });
    expect(pillOf('Мои уборки').backgroundColor).toBe(light.accent);
    expect(styleOf(titleOf('Мои уборки')).color).toBe(light.text);
  });

  test('an inactive tab: an outline icon, no pill, its title muted', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    expect(icons.get('queue')).toHaveBeenLastCalledWith({
      focused: false,
      color: light.textMuted,
      size: IconSize.regular,
    });
    expect(pillOf('Свободные').backgroundColor).toBeUndefined();
    expect(styleOf(titleOf('Свободные')).color).toBe(light.textMuted);
  });

  test('the pill is 60 × 30 and round, the icon centred in it', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    expect(pillOf('Мои уборки')).toMatchObject({
      width: 60,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    });
    expect(pillOf('Мои уборки').borderRadius).toBeGreaterThanOrEqual(15);
  });

  test('a title is a caption on one line, cut short rather than wrapped', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    const title = titleOf('Расходники');
    expect(styleOf(title).fontSize).toBe(FontSize.caption);
    expect(title.props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'tail' });
    // It follows the system font size like any text.
    expect(title.props.allowFontScaling).not.toBe(false);
  });

  test('at the largest system font a title grows to one and a half times, no more', async () => {
    // The bar is four tabs of a 320 dp screen: grown past 1.5 × 13 sp, a title
    // is cut to its first letters and the bar takes the screen's height.
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    for (const { title } of CLEANER_TABS) {
      expect(titleOf(title).props.maxFontSizeMultiplier).toBe(1.5);
    }
  });

  test('in the dark theme the active title is drawn at 700, an inactive one at 600', async () => {
    scheme.mockReturnValue('dark');

    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    expect(styleOf(titleOf('Мои уборки')).fontWeight).toBe('700');
    expect(styleOf(titleOf('Свободные')).fontWeight).toBe('600');
    expect(styleOf(titleOf('Свободные')).color).toBe(THEME_COLORS.dark.textMuted);
  });

  test('in the light theme, a step heavier for the sun, the active title still the heavier', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    const active = Number(styleOf(titleOf('Мои уборки')).fontWeight);
    const inactive = Number(styleOf(titleOf('Свободные')).fontWeight);
    expect(active).toBeGreaterThan(inactive);
  });

  test('each tab is the whole target: at least 48 dp high, the widths equal', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    for (const each of screen.getAllByRole('tab')) {
      const style = styleOf(each);
      expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(style.flex).toBe(1);
    }
  });

  test('the bar sits on the surface under a hairline and clears the home indicator', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    expect(styleOf(bar())).toMatchObject({
      backgroundColor: light.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: light.divider,
      paddingBottom: Spacing.xs + INSETS.bottom,
    });
  });

  // Block 3 (2026-10-10): the three-button navigation bar lies over the bottom
  // of the screen. The bar takes the inset the navigator measured — it is the
  // one thing on a tab screen that does; the lists above it do not.
  test.each(BOTTOM_INSETS)(
    'with a bottom inset of %i dp the tabs stand clear of the system’s bar',
    async (bottom) => {
      const props = barProps(CLEANER_TABS, 'index');
      await render(<TabBar {...props} insets={{ ...props.insets, bottom }} />);

      expect(styleOf(bar()).paddingBottom).toBe(Spacing.xs + bottom);
    },
  );
});

describe('on iOS, where VoiceOver knows no tab role', () => {
  beforeEach(() => {
    os.replaceValue('ios');
  });

  test('each tab is a button its name calls a tab and places, the active one selected', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'queue')} />);

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(
      screen.getByRole('button', { name: 'Свободные, вкладка, 2 из 4', selected: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Расходники, вкладка, 4 из 4', selected: false }),
    ).toBeTruthy();
  });

  test('a hidden screen is not counted among the places', async () => {
    await render(
      <TabBar {...barProps([MY, hiddenByHref(), QUEUE, PROBLEMS, SUPPLIES], 'queue')} />,
    );

    expect(screen.getByRole('button', { name: 'Свободные, вкладка, 2 из 4' })).toBeTruthy();
  });

  test('a screen’s own reader name is said as it is', async () => {
    const queue: FakeTab = { ...QUEUE, options: { tabBarAccessibilityLabel: 'Свободные уборки' } };

    await render(<TabBar {...barProps([MY, queue], 'index')} />);

    expect(screen.getByRole('button', { name: 'Свободные уборки' })).toBeTruthy();
  });
});

describe('what a press does — what the navigator’s own bar did', () => {
  test('a press on another tab tells the navigator, then goes there', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    await fireEvent.press(tab('Задания'));

    expect(emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'problems-key',
      canPreventDefault: true,
    });
    expect(navigate).toHaveBeenCalledWith('problems', undefined);
  });

  test('a press on the active tab only tells the navigator: a list scrolls to its top on it', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    await fireEvent.press(tab('Мои уборки'));

    expect(emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'index-key',
      canPreventDefault: true,
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a press a listener has prevented goes nowhere', async () => {
    emit.mockReturnValue({ defaultPrevented: true });
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    await fireEvent.press(tab('Свободные'));

    expect(navigate).not.toHaveBeenCalled();
  });

  test('a long press is the navigator’s tabLongPress', async () => {
    await render(<TabBar {...barProps(CLEANER_TABS, 'index')} />);

    await fireEvent(tab('Расходники'), 'longPress');

    expect(emit).toHaveBeenCalledWith({ type: 'tabLongPress', target: 'supplies-key' });
    expect(navigate).not.toHaveBeenCalled();
  });
});

test('it tells the navigator its height, as the stock bar did, for useBottomTabBarHeight', async () => {
  const onHeight = jest.fn();
  await render(
    <BottomTabBarHeightCallbackContext.Provider value={onHeight}>
      <TabBar {...barProps(CLEANER_TABS, 'index')} />
    </BottomTabBarHeightCallbackContext.Provider>,
  );

  await fireEvent(bar(), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 92 } },
  });

  expect(onHeight).toHaveBeenCalledWith(92);
});
