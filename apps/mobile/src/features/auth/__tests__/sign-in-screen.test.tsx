import { render, screen } from '@testing-library/react-native';

import SignInScreen from '@/app/sign-in';

/**
 * No letter can reset a password before launch — there is no mail server
 * (owner's decision 16, docs/f11-plan.md §3.5) — so the sign-in screen says
 * who can: the manager, in the panel.
 */

jest.mock('expo-router', () => ({ Redirect: () => null }));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: null, isLoading: false }),
  signIn: jest.fn(),
}));

test('tells her who can help with a forgotten password', async () => {
  // Act
  await render(<SignInScreen />);

  // Assert
  expect(screen.getByText('Забыли пароль? Обратитесь к менеджеру.')).toBeTruthy();
});
