import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { applyThemeChoice, THEME_COOKIE } from '@/lib/theme';

import { ThemeToggle } from './theme-toggle';

/**
 * The quick switch between the day and the night theme in the menu (the
 * owner's word, night of 2026-10-10): a lever, one press, the whole panel.
 */
describe('ThemeToggle', () => {
  // jsdom has no PointerEvent; Base UI's switch builds one on a press (as in ui/primitives.test).
  beforeAll(() => {
    if (typeof window.PointerEvent !== 'function') {
      Object.defineProperty(window, 'PointerEvent', {
        configurable: true,
        value: class PointerEvent extends MouseEvent {},
      });
    }
  });

  afterEach(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0`;
    vi.unstubAllGlobals();
  });

  test('is a switch named for the night theme, off in the day theme', () => {
    render(<ThemeToggle initial="light" />);

    const lever = screen.getByRole('switch', { name: 'Тёмная тема' });
    expect(lever).toHaveAttribute('aria-checked', 'false');
  });

  test('one press turns the panel dark and keeps it for the next visit', async () => {
    render(<ThemeToggle initial="light" />);

    await userEvent.click(screen.getByRole('switch', { name: 'Тёмная тема' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(screen.getByRole('switch', { name: 'Тёмная тема' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('and the next press back to the day theme', async () => {
    render(<ThemeToggle initial="dark" />);

    await userEvent.click(screen.getByRole('switch', { name: 'Тёмная тема' }));

    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
  });

  test('as the system says, it stands where the system is: dark at night', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );

    render(<ThemeToggle initial="system" />);

    expect(screen.getByRole('switch', { name: 'Тёмная тема' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('a choice made in «Настройки» moves the lever too', () => {
    render(<ThemeToggle initial="light" />);

    act(() => applyThemeChoice(document, 'dark'));

    expect(screen.getByRole('switch', { name: 'Тёмная тема' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('in the folded menu it is the lever alone, still named', () => {
    render(<ThemeToggle initial="light" isCompact />);

    expect(screen.getByRole('switch', { name: 'Тёмная тема' })).toBeInTheDocument();
    expect(screen.queryByText('Тёмная тема')).toBeNull();
  });
});
