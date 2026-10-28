import { THEME_COLORS } from '@str-ops/shared';
import { IsRestoringProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { withLayoutContext } from 'expo-router/build/layouts/withLayoutContext';
import type { BottomTabBarProps } from 'expo-router/tabs';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

import TabsLayout from '@/app/(tabs)/_layout';
import { applyWordContext } from '@/i18n';
import { knownRole, wordContextOf } from '@/features/auth/role';

import { TabBar } from '../tab-bar';

/**
 * Which tabs a person meets, by the role in her token (docs/tech-plan.md §4).
 * The cleaner keeps her four. The technician and the head technician have
 * nothing to do with cleanings: «Мои работы» and «Задания», no «Свободные» and
 * no «Расходники». The office on the phone, and a role this build does not
 * know, get the cleaner's — the view her tests already cover.
 *
 * The layout is rendered as it is, each screen's options are turned into the
 * bar's by expo-router's own `href` processor, and the phone's own bar draws
 * them: what is asserted is what she sees.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

interface DeclaredScreen {
  name: string;
  options: Readonly<Record<string, unknown>>;
}

/** What the layout declared, in its order. */
const mockScreens: DeclaredScreen[] = [];

/** The role in her token; undefined is a token without one. */
let mockRole: unknown = 'cleaner';

jest.mock('expo-router', () => {
  function Tabs({ children }: { children: ReactNode }) {
    return children;
  }
  Tabs.Screen = function Screen(screen: DeclaredScreen) {
    mockScreens.push({ name: screen.name, options: screen.options });
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

// Where expo-router builds its tab navigator (build/layouts/TabsClient.js) it
// hands over the function that turns `href` into the bar's options.
jest.mock('expo-router/build/layouts/withLayoutContext', () => ({
  withLayoutContext: jest.fn(() =>
    Object.assign(() => null, { Screen: () => null, Protected: () => null }),
  ),
}));
const processScreens = jest.mocked(withLayoutContext).mock.calls[0]?.[1];

jest.mock('expo-symbols', () => ({ SymbolView: () => null }));

// The layout's push wiring has its own tests (features/push/__tests__/hooks.test.tsx).
jest.mock('@/features/push/hooks', () => ({
  usePushTaps: jest.fn(),
  usePermissionPrompt: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: ME,
    isLoading: false,
    session: { user: { id: ME, app_metadata: mockRole === undefined ? {} : { role: mockRole } } },
  }),
  signOut: jest.fn(),
}));

/**
 * Signed in with a role, as the session provider does it: the token's role
 * for the screens, and its words for every text (features/auth/session.tsx).
 */
function signInAs(role: unknown): void {
  mockRole = role;
  applyWordContext(wordContextOf(knownRole(typeof role === 'string' ? role : null)));
}

/** The bar, drawn from what the layout declared, on its first tab. */
async function renderBar(): Promise<void> {
  if (processScreens === undefined) {
    throw new Error('expo-router built its tab navigator without a screen processor');
  }
  mockScreens.length = 0;
  await render(<TabsLayout />);
  const screens = processScreens(mockScreens) as DeclaredScreen[];
  const routes = screens.map(({ name }) => ({ key: `${name}-key`, name, params: undefined }));
  const props = {
    state: {
      type: 'tab',
      key: 'tabs-key',
      index: 0,
      routeNames: routes.map(({ name }) => name),
      routes,
      history: [],
      stale: false,
      preloadedRouteKeys: [],
    },
    descriptors: Object.fromEntries(
      screens.map(({ name, options }) => [`${name}-key`, { options }]),
    ),
    navigation: { emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;
  await render(<TabBar {...props} />);
}

function shownTabs(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel as string);
}

const CLEANER_TABS = ['Мои уборки', 'Свободные', 'Задания', 'Расходники'];
const TECHNICIAN_TABS = ['Мои работы', 'Задания'];

let os: jest.ReplaceProperty<typeof Platform.OS>;

beforeEach(() => {
  os = jest.replaceProperty(Platform, 'OS', 'android');
});

afterEach(() => {
  os.restore();
  signInAs('cleaner');
});

test.each([
  ['cleaner', CLEANER_TABS],
  ['tech', TECHNICIAN_TABS],
  ['head_tech', TECHNICIAN_TABS],
  ['manager', CLEANER_TABS],
  ['admin', CLEANER_TABS],
  ['auditor', CLEANER_TABS],
  [undefined, CLEANER_TABS],
])('a %s is shown the tabs %j', async (role, tabs) => {
  // Arrange
  signInAs(role);

  // Act
  await renderBar();

  // Assert
  expect(shownTabs()).toEqual(tabs);
});

test.each(['tech', 'head_tech'])(
  'a %s never meets «Свободные», «Расходники» or «Взять»',
  async (role) => {
    signInAs(role);

    await renderBar();

    for (const word of ['Свободные', 'Расходники', 'Взять', 'Мои уборки']) {
      expect(screen.queryByText(word, { includeHiddenElements: true })).toBeNull();
    }
  },
);

test.each(['tech', 'head_tech'])(
  'a %s’s hidden screens stay declared, out of the bar by expo-router’s href: null',
  async (role) => {
    signInAs(role);

    await renderBar();

    const hidden = mockScreens
      .filter(({ options }) => options.href === null)
      .map(({ name }) => name);
    expect(hidden).toEqual(['queue', 'supplies']);
  },
);

test('the cleaner’s screens are all in the bar, none hidden', async () => {
  signInAs('cleaner');

  await renderBar();

  expect(mockScreens.map(({ name }) => name)).toEqual(['index', 'queue', 'problems', 'supplies']);
  expect(mockScreens.some(({ options }) => 'href' in options)).toBe(false);
});

test('on iOS the reader counts only the technician’s two tabs', async () => {
  // Arrange: VoiceOver knows no tab; the name says it is one, and where.
  os.restore();
  os = jest.replaceProperty(Platform, 'OS', 'ios');
  signInAs('tech');

  // Act
  await renderBar();

  // Assert
  expect(screen.getAllByRole('button').map((tab) => tab.props.accessibilityLabel)).toEqual([
    'Мои работы, вкладка, 1 из 2',
    'Задания, вкладка, 2 из 2',
  ]);
});

test.each([
  ['cleaner', 'house'],
  ['tech', 'wrench'],
  ['head_tech', 'wrench'],
])('the first tab of a %s draws %s', async (role, glyph) => {
  signInAs(role);
  mockScreens.length = 0;
  await render(<TabsLayout />);
  const drawIcon = mockScreens.find(({ name }) => name === 'index')?.options.tabBarIcon as
    ((props: { focused: boolean; color: string; size: number }) => ReactNode) | undefined;
  expect(drawIcon).toBeDefined();

  await render(
    <View testID="icon">
      {drawIcon?.({ focused: false, color: THEME_COLORS.light.textMuted, size: 24 })}
    </View>,
  );

  const [box] = screen.getByTestId('icon', { includeHiddenElements: true }).children;
  if (box === undefined || typeof box === 'string') {
    throw new Error('the tab draws no icon');
  }
  const [drawing] = box.children;
  if (drawing === undefined || typeof drawing === 'string') {
    throw new Error('the icon holds no drawing');
  }
  expect(drawing.props.className).toContain(`lucide-${glyph}`);
});

/**
 * The cache is back from disk before it is checked against whose it is
 * (features/auth/forget-on-sign-out.ts): a session known in between drew the
 * last person's lists for a frame (docs/post-launch-cleanup.md). Until the
 * check is done the provider says it is still restoring: no tab is drawn,
 * and the wait is said — to the eye and to the reader — in the words the
 * entry screen used a moment before (app/index.tsx), never a blank screen.
 */
test('signed in while the lists brought back are still being checked: no tab yet, the wait said', async () => {
  // Arrange
  signInAs('cleaner');
  mockScreens.length = 0;

  // Act
  await render(
    <IsRestoringProvider value>
      <TabsLayout />
    </IsRestoringProvider>,
  );

  // Assert
  expect(mockScreens).toEqual([]);
  const loading = screen.getByRole('progressbar', { name: 'Входим…' });
  expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  expect(screen.getByText('Входим…')).toBeTruthy();
});
