import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';

import { THEME_COOKIE } from '@/lib/theme';

import { ThemeSwitcher } from '../theme-switcher';

describe('ThemeSwitcher', () => {
  afterEach(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0`;
  });

  test('offers the system’s theme, light and dark, starting from the saved one', () => {
    render(<ThemeSwitcher initial="light" />);

    const select = screen.getByRole('combobox', { name: 'Тема' });
    expect(select).toHaveValue('light');
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Как в системе', 'Светлая', 'Тёмная']);
  });

  test('a choice repaints the panel at once and is kept for the next visit', async () => {
    render(<ThemeSwitcher initial="system" />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Тема' }), 'dark');

    expect(screen.getByRole('combobox', { name: 'Тема' })).toHaveValue('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
  });
});
