import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/problems',
}));

import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  test('lists every section and marks the current one', () => {
    render(<Sidebar email="manager.test@example.com" />);

    expect(screen.getByRole('link', { name: 'Проблемы' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Задания' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('manager.test@example.com')).toBeInTheDocument();
  });

  test('does not offer a way out next to the navigation', () => {
    render(<Sidebar email="manager.test@example.com" />);

    // One press under the menu is where a hand goes by accident; signing out
    // asks first now, from Settings.
    expect(screen.queryByRole('button', { name: 'Выйти' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Настройки' })).toBeInTheDocument();
  });
});
