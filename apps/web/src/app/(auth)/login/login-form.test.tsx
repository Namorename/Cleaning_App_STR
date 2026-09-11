import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

vi.mock('./actions', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { signIn } from './actions';
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

  test('the password can be read back before it is sent', async () => {
    render(<LoginForm next="/dashboard" />);
    const password = screen.getByLabelText('Пароль');

    expect(password).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Показать пароль' }));
    expect(password).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Скрыть пароль' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  test('the eye is not a second submit button', () => {
    render(<LoginForm next="/dashboard" />);

    // Inside a form an unnamed button submits it, which would send the form
    // every time somebody wanted to check what they had typed.
    expect(screen.getByRole('button', { name: 'Показать пароль' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  test('a refused attempt keeps the address that was typed', async () => {
    // What the action hands back after "wrong password": the issue, and the
    // address. React clears the form on its own, so the field is rebuilt from
    // this — see SignInState.email.
    vi.mocked(signIn).mockResolvedValue({ issue: 'invalid', email: 'manager.test@example.com' });
    render(<LoginForm next="/dashboard" />);

    await userEvent.type(screen.getByLabelText('Эл. почта'), 'manager.test@example.com');
    await userEvent.type(screen.getByLabelText('Пароль'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Неверная почта или пароль');
    expect(screen.getByLabelText('Эл. почта')).toHaveValue('manager.test@example.com');
    // The password is not handed back: retyping it is the point.
    expect(screen.getByLabelText('Пароль')).toHaveValue('');
  }, 20000);
});
