import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/problems',
}));

// The marks come from one company-wide answer; here it is a pair of sets the
// test fills by hand.
const unread = { tasks: new Set<string>(), problems: new Set<string>() };
vi.mock('@/features/chat/use-chat', () => ({ useUnreadSubjects: () => unread }));

afterEach(() => {
  unread.tasks.clear();
  unread.problems.clear();
});

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

  test('counts the conversations waiting under each section', () => {
    unread.tasks.add('a').add('b');
    unread.problems.add('c');
    render(<Sidebar email="manager.test@example.com" />);

    expect(screen.getByRole('link', { name: /Задания/ })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: /Проблемы/ })).toHaveTextContent('1');
    expect(screen.getByLabelText('Непрочитанных: 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Календарь' })).not.toHaveTextContent(/\d/);
  });

  test('shows no count while nothing waits', () => {
    render(<Sidebar email="manager.test@example.com" />);

    expect(screen.queryByLabelText(/Непрочитанных/)).not.toBeInTheDocument();
  });
});
