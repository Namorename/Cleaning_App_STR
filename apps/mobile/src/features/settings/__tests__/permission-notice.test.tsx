import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking, Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { BUTTON_HEIGHT, Colors } from '@/constants/theme';
import { registerThisPhone } from '@/features/push/registration';
import { setWordContext } from '@/testing/word-context';

import { PermissionNotice } from '../permission-notice';

/**
 * What the phone itself allows, above her switches in the Settings. The
 * switches decide what the server sends; this says whether the phone lets
 * any of it through, and gives the one way to change that from here.
 */

jest.mock('@/features/push/registration', () => ({
  registerThisPhone: jest.fn(async () => true),
}));
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));
jest.mock('@/lib/sentry', () => ({ reportError: jest.fn(), reportUnlessOffline: jest.fn() }));

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const request = Notifications.requestPermissionsAsync as jest.Mock;
const getChannel = Notifications.getNotificationChannelAsync as jest.Mock;
const originalOS = Platform.OS;

const allowed = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
const neverAsked = { status: 'denied', granted: false, canAskAgain: true, expires: 'never' };
const refused = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };

function runOn(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

beforeEach(() => {
  jest.clearAllMocks();
  runOn('android');
});

afterEach(() => {
  runOn(originalOS);
  getPermissions.mockReset().mockResolvedValue(allowed);
  request.mockReset().mockResolvedValue(allowed);
  getChannel.mockReset().mockResolvedValue(null);
});

test('a phone that lets pushes through shows nothing', async () => {
  await render(<PermissionNotice />);
  await waitFor(() => expect(getPermissions).toHaveBeenCalled());

  expect(screen.queryByRole('button')).toBeNull();
});

test('never asked: says so, and "Turn on" asks and registers the phone', async () => {
  getPermissions.mockResolvedValue(neverAsked);
  await render(<PermissionNotice />);

  expect(
    await screen.findByText('Телефон ещё не разрешил приложению присылать уведомления.'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Включить уведомления' }));

  await waitFor(() => expect(registerThisPhone).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledTimes(1);
});

test('refused: says so, and opens the phone settings', async () => {
  getPermissions.mockResolvedValue(refused);
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await render(<PermissionNotice />);

  expect(await screen.findByText(/Уведомления выключены в настройках телефона/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Открыть настройки телефона' }));

  expect(openSettings).toHaveBeenCalledTimes(1);
  openSettings.mockRestore();
});

// What a technician misses without pushes is his jobs (docs/tech-plan.md §6).
test('refused, to a technician: he will not hear about new jobs', async () => {
  getPermissions.mockResolvedValue(refused);
  await setWordContext('tech');

  try {
    await render(<PermissionNotice />);

    expect(
      await screen.findByText(/Без них вы не узнаете о новых работах и сообщениях/),
    ).toBeTruthy();
  } finally {
    await setWordContext(undefined);
  }
});

test('a question the phone never showed leaves the settings as the way', async () => {
  getPermissions.mockResolvedValue(neverAsked);
  request.mockResolvedValueOnce(neverAsked);
  await render(<PermissionNotice />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Включить уведомления' }));

  expect(await screen.findByRole('button', { name: 'Открыть настройки телефона' })).toBeTruthy();
  expect(registerThisPhone).not.toHaveBeenCalled();
});

test('a channel switched off on Android is named', async () => {
  getChannel.mockImplementation(async (id: string) => ({
    id,
    importance:
      id === 'urgent'
        ? Notifications.AndroidImportance.NONE
        : Notifications.AndroidImportance.DEFAULT,
  }));
  await render(<PermissionNotice />);

  expect(
    await screen.findByText('В настройках телефона выключены «Срочные уведомления».'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Открыть настройки телефона' })).toBeTruthy();
});

test('an iPhone delivering quietly says where they go', async () => {
  runOn('ios');
  getPermissions.mockResolvedValue({
    ...neverAsked,
    status: 'undetermined',
    ios: { status: Notifications.IosAuthorizationStatus.PROVISIONAL },
  });
  await render(<PermissionNotice />);

  expect(await screen.findByText(/только в Центр уведомлений/)).toBeTruthy();
});

describe('on the «Абрикос» components', () => {
  const light = Colors.light;

  function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
    return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
  }

  /** The Lucide drawings inside the notice, by their canonical names. */
  function glyphs(name: string): number {
    return screen.container.queryAll((node) =>
      String(node.props.className ?? '').includes(`lucide-${name}`),
    ).length;
  }

  test('the way to turn them on is a 56 dp button', async () => {
    getPermissions.mockResolvedValue(neverAsked);

    await render(<PermissionNotice />);

    const button = await screen.findByRole('button', { name: 'Включить уведомления' });
    expect(styleOf(button).minHeight).toBe(BUTTON_HEIGHT);
  });

  test('while the system asks, the button keeps its words, busy', async () => {
    // Arrange: the system question stays on screen.
    getPermissions.mockResolvedValue(neverAsked);
    request.mockReturnValue(new Promise(() => undefined));
    await render(<PermissionNotice />);

    // Act
    await fireEvent.press(await screen.findByRole('button', { name: 'Включить уведомления' }));

    // Assert
    expect(screen.getByText('Включить уведомления')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Включить уведомления' }).props.accessibilityState,
    ).toMatchObject({ disabled: true, busy: true });
  });

  test('an urgent notice carries the urgent glyph beside its words, in its ink', async () => {
    getPermissions.mockResolvedValue(refused);

    await render(<PermissionNotice />);

    const line = await screen.findByText(/Уведомления выключены в настройках телефона/);
    expect(styleOf(line).color).toBe(light.tone.urgent.fg);
    expect(glyphs('circle-alert')).toBeGreaterThan(0);
  });

  test('an iPhone delivering quietly is only a fact: no alarm glyph', async () => {
    runOn('ios');
    getPermissions.mockResolvedValue({
      ...neverAsked,
      status: 'undetermined',
      ios: { status: Notifications.IosAuthorizationStatus.PROVISIONAL },
    });

    await render(<PermissionNotice />);

    expect(await screen.findByText(/только в Центр уведомлений/)).toBeTruthy();
    expect(glyphs('circle-alert')).toBe(0);
  });
});
