import { render, screen } from '@testing-library/react-native';

import Index from '@/app/index';

/**
 * The app's entry (app/index). Reading the stored session is asynchronous, so
 * it waits for it — saying so — and only then sends her to sign in or to her
 * tabs: redirecting sooner would bounce a signed-in cleaner to the sign-in
 * screen on every cold start.
 */

const mockSession = { userId: null as string | null, isLoading: false };
const mockRedirect = jest.fn();

jest.mock('@/features/auth/session', () => ({ useSession: () => mockSession }));

jest.mock('expo-router', () => ({
  Redirect: function Redirect({ href }: { href: string }) {
    mockRedirect(href);
    return null;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.userId = null;
  mockSession.isLoading = false;
});

test('while the stored session is read it says so, and sends her nowhere yet', async () => {
  mockSession.isLoading = true;

  await render(<Index />);

  expect(screen.getByText('Входим…')).toBeTruthy();
  expect(mockRedirect).not.toHaveBeenCalled();
});

test('signed out, it leads to the sign-in screen', async () => {
  await render(<Index />);

  expect(mockRedirect).toHaveBeenCalledWith('/sign-in');
});

test('signed in, it leads to her tabs', async () => {
  mockSession.userId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  await render(<Index />);

  expect(mockRedirect).toHaveBeenCalledWith('/(tabs)');
});

test('the wait is one element for the reader: a busy progress bar named «Входим…»', async () => {
  mockSession.isLoading = true;

  await render(<Index />);

  const loading = screen.getByRole('progressbar', { name: 'Входим…' });
  expect(loading.props.accessibilityState).toMatchObject({ busy: true });
});
