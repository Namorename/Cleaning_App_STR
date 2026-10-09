import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { BUTTON_HEIGHT, Colors, FontSize, Spacing } from '@/constants/theme';
import { reportError } from '@/lib/sentry';
import { BOTTOM_INSETS, scrollEndPadding, withBottomInset } from '@/testing/insets';
import { setWordContext } from '@/testing/word-context';

import { ensureChannels } from '../channels';
import { PermissionExplainer } from '../permission-explainer';
import { registerThisPhone } from '../registration';

/**
 * The screen before the system's own question: why the app wants to send
 * notifications, and what it never shows in them. "Allow" brings up the
 * system question; "Not now" closes the screen and asks nothing.
 */

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('../registration', () => ({ registerThisPhone: jest.fn(async () => true) }));
jest.mock('../channels', () => ({ ensureChannels: jest.fn(async () => undefined) }));
jest.mock('@/lib/sentry', () => ({ reportError: jest.fn(), reportUnlessOffline: jest.fn() }));
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

const request = Notifications.requestPermissionsAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

test('says why, and that the text of a message is never shown', async () => {
  await render(<PermissionExplainer />);

  expect(screen.getByRole('header', { name: 'Не пропустите уборку' })).toBeTruthy();
  expect(screen.getByText(/Текст сообщений в уведомлении не показывается/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Разрешить уведомления' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Не сейчас' })).toBeTruthy();
});

// A technician's pushes are about his jobs (docs/tech-plan.md §5, §6).
test('to a technician it speaks of jobs, not cleanings', async () => {
  await setWordContext('tech');

  try {
    await render(<PermissionExplainer />);

    expect(screen.getByRole('header', { name: 'Не пропустите работу' })).toBeTruthy();
    expect(screen.getByText(/когда вам назначат работу/)).toBeTruthy();
    expect(screen.queryByText(/уборк/i)).toBeNull();
  } finally {
    await setWordContext(undefined);
  }
});

test('"Allow": channels first, then the system question; the screen closes and the phone registers behind it', async () => {
  const order: string[] = [];
  jest.mocked(ensureChannels).mockImplementationOnce(async () => {
    order.push('channels');
  });
  request.mockImplementationOnce(async () => {
    order.push('question');
    return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
  });
  jest.mocked(registerThisPhone).mockImplementationOnce(async () => {
    order.push('register');
    return true;
  });
  await render(<PermissionExplainer />);

  await fireEvent.press(screen.getByRole('button', { name: 'Разрешить уведомления' }));

  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  expect(order).toEqual(['channels', 'question', 'register']);
  expect(registerThisPhone).toHaveBeenCalledWith('7c9e6679-7425-40de-944b-e07fc1f90ae7');
});

test('a registration that never answers does not keep the screen open', async () => {
  // Registering reaches Apple or Google, then Expo, then the server: a stairwell away.
  jest
    .mocked(registerThisPhone)
    .mockImplementationOnce(() => new Promise<boolean>(() => undefined));
  await render(<PermissionExplainer />);

  await fireEvent.press(screen.getByRole('button', { name: 'Разрешить уведомления' }));

  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
});

test('a "no" to the system question closes the screen and registers nothing', async () => {
  request.mockResolvedValueOnce({
    status: 'denied',
    granted: false,
    canAskAgain: false,
    expires: 'never',
  });
  await render(<PermissionExplainer />);

  await fireEvent.press(screen.getByRole('button', { name: 'Разрешить уведомления' }));

  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  expect(registerThisPhone).not.toHaveBeenCalled();
});

test('"Not now" closes the screen without the system question', async () => {
  await render(<PermissionExplainer />);

  await fireEvent.press(screen.getByRole('button', { name: 'Не сейчас' }));

  expect(router.back).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});

test('a failure is said on the screen and reported, and she can still leave', async () => {
  request.mockRejectedValueOnce(new Error('native module missing'));
  await render(<PermissionExplainer />);

  await fireEvent.press(screen.getByRole('button', { name: 'Разрешить уведомления' }));

  expect(await screen.findByText('Не удалось включить уведомления.')).toBeTruthy();
  expect(reportError).toHaveBeenCalledTimes(1);
  expect(router.back).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Не сейчас' }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

describe('on the «Абрикос» components', () => {
  const light = Colors.light;

  function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
    return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
  }

  test('«Разрешить уведомления» is the 56 dp main button; «Не сейчас» an outlined one', async () => {
    await render(<PermissionExplainer />);

    const allow = styleOf(screen.getByRole('button', { name: 'Разрешить уведомления' }));
    expect(allow.minHeight).toBe(BUTTON_HEIGHT);
    expect(allow.backgroundColor).toBe(light.cta);
    const later = styleOf(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(later.minHeight).toBe(BUTTON_HEIGHT);
    expect(later.borderColor).toBe(light.primary);
  });

  test('while the system asks, «Разрешить» keeps its words, busy', async () => {
    // Arrange: the system question stays on screen.
    request.mockReturnValueOnce(new Promise(() => undefined));
    await render(<PermissionExplainer />);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Разрешить уведомления' }));

    // Assert
    expect(screen.getByText('Разрешить уведомления')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Разрешить уведомления' }).props.accessibilityState,
    ).toMatchObject({ disabled: true, busy: true });
  });

  test('the words: a title, the body, the hint secondary, a failure in danger', async () => {
    request.mockRejectedValueOnce(new Error('native module missing'));
    await render(<PermissionExplainer />);

    expect(styleOf(screen.getByText('Не пропустите уборку')).fontSize).toBe(FontSize.title);
    expect(styleOf(screen.getByText(/Текст сообщений/)).fontSize).toBe(FontSize.body);
    expect(styleOf(screen.getByText(/Передумаете/)).color).toBe(light.textSecondary);

    await fireEvent.press(screen.getByRole('button', { name: 'Разрешить уведомления' }));

    expect(styleOf(await screen.findByText('Не удалось включить уведомления.')).color).toBe(
      light.danger,
    );
  });
});

// Block 3 (2026-10-10): Android's three-button navigation bar lay over the
// bottom of the screens. «Не сейчас» is the last thing here; at a large font
// it reaches the bottom, and scrolled to the end it stops clear of the
// system's bar. On iOS UIKit insets this scroll view itself.
describe.each(BOTTOM_INSETS)('with a bottom inset of %i dp', (bottom) => {
  let os: { restore: () => void } | undefined;

  afterEach(() => {
    os?.restore();
    os = undefined;
  });

  test('on Android «Не сейчас» scrolls clear of the system’s bar', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'android');
    await render(withBottomInset(bottom, <PermissionExplainer />));

    expect(screen.getByRole('button', { name: 'Не сейчас' })).toBeTruthy();
    expect(scrollEndPadding()).toBe(Spacing.xl + bottom);
  });

  test('on iOS the system insets it, and the screen adds nothing', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'ios');
    await render(withBottomInset(bottom, <PermissionExplainer />));

    expect(scrollEndPadding()).toBe(Spacing.xl);
  });
});
