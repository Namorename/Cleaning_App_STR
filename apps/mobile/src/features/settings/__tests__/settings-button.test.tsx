import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import TabsLayout from '@/app/(tabs)/_layout';

import { SettingsButton } from '../settings-button';

/**
 * The way into the settings is the gear in the tab header, where "Sign out"
 * used to be; signing out moved to the bottom of the settings screen.
 */

const mockPush = jest.fn();

interface MockTabsProps {
  screenOptions: { headerRight?: (props: object) => ReactNode };
}

jest.mock('expo-router', () => {
  // The tab navigator reduced to the one thing asserted here: its header's
  // right-hand side, drawn the way the navigator calls it.
  function Tabs({ screenOptions }: MockTabsProps) {
    return screenOptions.headerRight?.({}) ?? null;
  }
  Tabs.Screen = function Screen() {
    return null;
  };
  return {
    Tabs,
    Redirect: function Redirect() {
      return null;
    },
    router: { push: (...args: unknown[]) => mockPush(...args) },
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

beforeEach(() => {
  jest.clearAllMocks();
});

test('the gear opens the settings and is named for a screen reader', async () => {
  // Arrange
  await render(<SettingsButton />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Настройки' }));

  // Assert
  expect(mockPush).toHaveBeenCalledWith('/settings');
});

test('the tab header carries the gear, and signing out is no longer there', async () => {
  // Act
  await render(<TabsLayout />);

  // Assert
  expect(screen.getByRole('button', { name: 'Настройки' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Выйти' })).toBeNull();
});
