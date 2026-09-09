import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('./actions', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { LoginForm } from './login-form';

describe('LoginForm', () => {
  test('asks for email and password in the manager language', () => {
    render(<LoginForm next="/dashboard" />);

    expect(screen.getByLabelText('Эл. почта')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled();
  });

  test('carries the page to return to after sign-in', () => {
    const { container } = render(<LoginForm next="/problems" />);

    expect(container.querySelector('input[name="next"]')).toHaveValue('/problems');
  });
});
