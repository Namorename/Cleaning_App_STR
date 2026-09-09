import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/problems',
}));

import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  test('lists every section and marks the current one', () => {
    render(<Sidebar email="manager.test@example.com" onSignOut={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Проблемы' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Задания' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
    expect(screen.getByText('manager.test@example.com')).toBeInTheDocument();
  });
});
