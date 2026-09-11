import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { SignOut } from './sign-out';

describe('SignOut', () => {
  test('asks before it does anything', async () => {
    const onSignOut = vi.fn();
    render(<SignOut onSignOut={onSignOut} />);

    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Выйти из аккаунта?')).toBeInTheDocument();
    expect(within(dialog).getByText('Для входа снова понадобится пароль.')).toBeInTheDocument();
    // Opening the question is not answering it.
    expect(onSignOut).not.toHaveBeenCalled();
  });

  test('a second press is what actually signs out', async () => {
    const onSignOut = vi.fn();
    render(<SignOut onSignOut={onSignOut} />);

    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Выйти' }));

    expect(onSignOut).toHaveBeenCalled();
  });

  test('changing your mind costs nothing', async () => {
    const onSignOut = vi.fn();
    render(<SignOut onSignOut={onSignOut} />);

    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
