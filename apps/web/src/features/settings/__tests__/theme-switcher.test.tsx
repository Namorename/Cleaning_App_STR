import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';

import { applyThemeChoice, THEME_COOKIE } from '@/lib/theme';

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

// Night of 2026-10-10: the lever in the menu and this choice are one setting.
test('a press of the lever in the menu shows here at once', () => {
  render(<ThemeSwitcher initial="system" />);

  act(() => applyThemeChoice(document, 'dark'));

  expect(screen.getByRole('combobox', { name: 'Тема' })).toHaveValue('dark');
  document.documentElement.classList.remove('light', 'dark');
});

// Review of 2981da8..db36705: back on «Настройки» after a press of the lever,
// the page's cached choice was the old one.
test('drawn again after the lever was pressed, it shows the choice made since', () => {
  document.documentElement.dataset.themeChoice = 'dark';

  render(<ThemeSwitcher initial="system" />);

  expect(screen.getByRole('combobox', { name: 'Тема' })).toHaveValue('dark');
  delete document.documentElement.dataset.themeChoice;
});
