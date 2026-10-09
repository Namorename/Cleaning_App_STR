import { THEME_COLORS } from '@str-ops/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, Platform, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import SignInScreen from '@/app/sign-in';
import { BUTTON_HEIGHT, Spacing } from '@/constants/theme';
import { signIn } from '@/features/auth/session';
import { i18n } from '@/i18n';

/**
 * The sign-in screen (decisions.md §2, «Вход и вкладки», variant 1): the mark,
 * the heading «Вход» (decision 8), the two fields, a refusal and who can help
 * with a forgotten password, from the top of the screen; «Войти» the screen's
 * main button, pinned at its bottom edge in the thumb's reach and riding above
 * the keyboard. How signing in works is guarded by sign-in-password.test.tsx.
 */

jest.mock('expo-router', () => ({ Redirect: () => null }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: null, isLoading: false }),
  signIn: jest.fn(async () => {}),
}));

/**
 * The keyboard is native, so what is checked is what the screen asks of React
 * Native's KeyboardAvoidingView: the props it was drawn with are recorded, and
 * what it holds is marked.
 */
const mockAvoidingProps: { behavior?: string; keyboardVerticalOffset?: number }[] = [];

jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function MockKeyboardAvoidingView(props: {
    behavior?: string;
    keyboardVerticalOffset?: number;
    children?: unknown;
  }) {
    mockAvoidingProps.push(props);
    return createElement(View, { testID: 'keyboard-avoiding' }, props.children);
  }
  return { __esModule: true, default: MockKeyboardAvoidingView };
});

const light = THEME_COLORS.light;
const SIGN_IN = 'Войти';
const FORGOT = 'Забыли пароль? Обратитесь к менеджеру.';
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };

const email = () => screen.getByLabelText('Почта');
const password = () => screen.getByLabelText('Пароль');
/** What scrolls: the mark, the heading, the fields, a refusal, the help line. */
const form = () => screen.getByTestId('sign-in-form');
/** The strip «Войти» is pinned in. */
const actions = () => screen.getByTestId('sign-in-actions');

async function fillIn(address = 'anna@example.cz', secret = 'Kx7mQ2pL9vRt') {
  await fireEvent.changeText(email(), address);
  await fireEvent.changeText(password(), secret);
}

function styleOf(element: { props: { style?: unknown } }): ViewStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) ?? {};
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAvoidingProps.length = 0;
  jest.mocked(signIn).mockResolvedValue(undefined);
});

describe('the form, from the top of the screen', () => {
  test('the mark first, then the heading «Вход»', async () => {
    await render(<SignInScreen />);

    const heading = within(form()).getByRole('header', { name: 'Вход' });
    const mark = within(form()).getByTestId('brand-mark', { includeHiddenElements: true });
    const parent = heading.parent;
    expect(mark.parent).toBe(parent);
    const order = parent?.children ?? [];
    expect(order.indexOf(mark)).toBeLessThan(order.indexOf(heading));
  });

  test.each([
    ['ru', 'Вход'],
    ['en', 'Sign in'],
    ['cs', 'Přihlášení'],
  ])('the heading in %s is «%s» (decision 8)', (language, heading) => {
    expect(i18n.getFixedT(language)('auth.heading')).toBe(heading);
  });

  test('the fields and who can help with a forgotten password are in it; nothing centres it', async () => {
    await render(<SignInScreen />);

    expect(within(form()).getByLabelText('Почта')).toBeTruthy();
    expect(within(form()).getByLabelText('Пароль')).toBeTruthy();
    // No letter can reset a password before launch — there is no mail server
    // (owner's decision 16, docs/f11-plan.md §3.5) — so the screen says who can.
    expect(within(form()).getByText(FORGOT)).toBeTruthy();
    const content = StyleSheet.flatten(form().props.contentContainerStyle) as ViewStyle;
    expect(content.justifyContent ?? 'flex-start').toBe('flex-start');
  });

  test('a refusal is said in the form, under the fields, not beside the button', async () => {
    jest.mocked(signIn).mockRejectedValue({ code: 'invalid_credentials', status: 400 });
    await render(<SignInScreen />);
    await fillIn();

    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN }));

    expect(await within(form()).findByText('Неверная почта или пароль.')).toBeTruthy();
    expect(within(actions()).queryByText('Неверная почта или пароль.')).toBeNull();
  });
});

describe('«Войти» at the bottom', () => {
  test('is the screen’s main button, pinned under what scrolls, not in it', async () => {
    await render(<SignInScreen />);
    await fillIn();

    expect(within(form()).queryByRole('button', { name: SIGN_IN })).toBeNull();
    const button = within(actions()).getByRole('button', { name: SIGN_IN });
    expect(styleOf(button)).toMatchObject({
      minHeight: BUTTON_HEIGHT,
      backgroundColor: light.cta,
    });
  });

  test('sits at the screen’s edge, clear of the home indicator', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={INSETS}>
        <SignInScreen />
      </SafeAreaInsetsContext.Provider>,
    );

    expect(styleOf(actions()).paddingBottom).toBe(Spacing.md + INSETS.bottom);
  });

  test('rides above the keyboard on both systems', async () => {
    await render(<SignInScreen />);

    // Padding on both: see the screen for why Android is no exception.
    expect(mockAvoidingProps.at(-1)).toEqual(expect.objectContaining({ behavior: 'padding' }));
    const avoiding = screen.getByTestId('keyboard-avoiding');
    expect(within(avoiding).getByTestId('sign-in-actions')).toBeTruthy();
  });

  test('waits for both fields: an address of spaces is no address', async () => {
    await render(<SignInScreen />);
    const isDisabled = () =>
      screen.getByRole('button', { name: SIGN_IN }).props.accessibilityState?.disabled;

    expect(isDisabled()).toBe(true);
    await fillIn('   ', 'Kx7mQ2pL9vRt');
    expect(isDisabled()).toBe(true);
    await fireEvent.changeText(email(), 'anna@example.cz');
    expect(isDisabled()).toBe(false);
  });

  test('while signing in it says «Входим…», busy, and a second tap does nothing', async () => {
    let finish: () => void = () => {};
    jest.mocked(signIn).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await render(<SignInScreen />);
    await fillIn();

    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN }));

    const busy = within(actions()).getByRole('button', { name: 'Входим…' });
    expect(busy.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(busy);
    expect(signIn).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(screen.getByRole('button', { name: SIGN_IN })).toBeTruthy();
  });
});

describe('a refusal, said where she will see and hear it', () => {
  const REFUSAL = 'Неверная почта или пароль.';
  let os: jest.ReplaceProperty<typeof Platform.OS> | undefined;
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

  beforeEach(() => {
    announce.mockImplementation(() => {});
    jest.mocked(signIn).mockRejectedValue({ code: 'invalid_credentials', status: 400 });
  });

  afterEach(() => {
    os?.restore();
    os = undefined;
  });

  test('«Войти» puts the keyboard away, so the refusal under the fields is in view', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await render(<SignInScreen />);
    await fillIn();

    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN }));

    expect(dismiss).toHaveBeenCalled();
    expect(await within(form()).findByText(REFUSAL)).toBeTruthy();
  });

  test('VoiceOver says it aloud: iOS has no live region', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'ios');
    await render(<SignInScreen />);
    await fillIn();

    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN }));

    await waitFor(() => expect(announce).toHaveBeenCalledWith(REFUSAL));
  });

  test('TalkBack hears it from the live region, and only from there', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'android');
    await render(<SignInScreen />);
    await fillIn();

    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN }));

    expect(await within(form()).findByText(REFUSAL)).toBeTruthy();
    expect(screen.getByTestId('sign-in-failure').props.accessibilityLiveRegion).toBe('polite');
    expect(announce).not.toHaveBeenCalled();
  });

  test('a failure this build cannot name: a sentence she reads, the server’s own words under it', async () => {
    jest.mocked(signIn).mockRejectedValue(new Error('Database error querying schema'));
    await render(<SignInScreen />);
    await fillIn();

    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN }));

    expect(await within(form()).findByText('Database error querying schema')).toBeTruthy();
    expect(within(form()).queryByText(REFUSAL)).toBeNull();
  });
});

describe('the keyboard', () => {
  test('«Go» on the password’s keyboard signs in as the button would', async () => {
    await render(<SignInScreen />);
    await fillIn('anna@example.cz ', 'Kx7mQ2pL9vRt ');

    expect(password().props.returnKeyType).toBe('go');
    await fireEvent(password(), 'submitEditing');

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('anna@example.cz', 'Kx7mQ2pL9vRt'));
  });

  test('«Go» before the address is in does nothing, as the button would not', async () => {
    await render(<SignInScreen />);
    await fireEvent.changeText(password(), 'Kx7mQ2pL9vRt');

    await fireEvent(password(), 'submitEditing');

    expect(signIn).not.toHaveBeenCalled();
  });
});
