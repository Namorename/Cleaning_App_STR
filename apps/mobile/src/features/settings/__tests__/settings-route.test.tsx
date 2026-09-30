import { render, screen } from '@testing-library/react-native';

import SettingsRoute from '@/app/settings';

/**
 * The settings sit on the root stack, above the tabs whose redirect guards
 * the rest of the app. Signing out happens right here, so this route has to
 * send her to the sign-in screen by itself.
 */

const mockSession = { userId: null as string | null, isLoading: false };
const mockRedirect = jest.fn();
const mockSettingsDrawn = jest.fn();

jest.mock('@/features/auth/session', () => ({
  useSession: () => mockSession,
}));

jest.mock('expo-router', () => ({
  Redirect: function Redirect({ href }: { href: string }) {
    mockRedirect(href);
    return null;
  },
}));

jest.mock('../settings-screen', () => ({
  SettingsScreen: function SettingsScreen() {
    mockSettingsDrawn();
    return null;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.userId = null;
  mockSession.isLoading = false;
});

test('signed out, it leads to the sign-in screen', async () => {
  await render(<SettingsRoute />);

  expect(mockRedirect).toHaveBeenCalledWith('/sign-in');
  expect(mockSettingsDrawn).not.toHaveBeenCalled();
});

test('signed in, it shows the settings', async () => {
  mockSession.userId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  await render(<SettingsRoute />);

  expect(mockSettingsDrawn).toHaveBeenCalled();
  expect(mockRedirect).not.toHaveBeenCalled();
});

// The same guard as a cleaning and a thread (SignedInRoute): the wait is said,
// not a blank screen (docs/f11-ultrareview.md, finding 2).
test('while the stored session is still being read, it waits and says so', async () => {
  mockSession.isLoading = true;

  await render(<SettingsRoute />);

  expect(screen.getByText('Загружаем настройки…')).toBeTruthy();
  expect(mockSettingsDrawn).not.toHaveBeenCalled();
  expect(mockRedirect).not.toHaveBeenCalled();
});
