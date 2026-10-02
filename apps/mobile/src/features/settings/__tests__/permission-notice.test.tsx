import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { registerThisPhone } from '@/features/push/registration';

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
