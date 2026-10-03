import { ICONS, type IconMeaning } from '@str-ops/shared';
import { render, screen, within } from '@testing-library/react';
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

function linkTexts(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
}

describe('Sidebar', () => {
  test('lists every section and marks the current one', () => {
    render(<Sidebar email="manager.test@example.com" />);

    expect(screen.getByRole('link', { name: 'Задания' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Уборки' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('manager.test@example.com')).toBeInTheDocument();
  });

  test('groups the sections in the owner’s order, Settings apart at the bottom', () => {
    render(<Sidebar email="manager.test@example.com" />);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });

    // docs/design/decisions.md §4: the day's work, then what it is done in
    // and by whom; Settings on its own under both groups.
    expect(linkTexts(within(nav).getByRole('group', { name: 'Работа' }))).toEqual([
      'Дашборд',
      'Календарь',
      'Уборки',
      'Задания',
      'Заявки',
    ]);
    expect(linkTexts(within(nav).getByRole('group', { name: 'Справочники' }))).toEqual([
      'Объекты',
      'Команда',
    ]);

    const settings = within(nav).getByRole('link', { name: 'Настройки' });
    expect(linkTexts(nav).at(-1)).toBe('Настройки');
    expect(within(nav).getAllByRole('group').some((group) => group.contains(settings))).toBe(
      false,
    );
  });

  test('keeps every route where it was', () => {
    render(<Sidebar email="manager.test@example.com" />);

    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toEqual([
      '/dashboard',
      '/calendar',
      '/tasks',
      '/problems',
      '/supplies',
      '/apartments',
      '/team',
      '/settings',
    ]);
  });

  test('draws each section’s icon from the shared map, out of the screen reader’s way', () => {
    render(<Sidebar email="manager.test@example.com" />);

    for (const link of screen.getAllByRole('link')) {
      // `/tasks` → `nav.tasks`: the routes are the meanings' names.
      const meaning = `nav.${link.getAttribute('href')?.slice(1)}` as IconMeaning;
      const icon = link.querySelector('svg');

      expect(icon).toHaveClass(`lucide-${ICONS[meaning]}`);
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('puts the logo above the menu, one picture for each theme', () => {
    render(<Sidebar email="manager.test@example.com" />);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    const logos = screen.getAllByRole('img', { name: 'woom' });

    expect(logos).toHaveLength(2);
    for (const logo of logos) {
      expect(logo.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
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

    expect(screen.getByRole('link', { name: /Уборки/ })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: /Задания/ })).toHaveTextContent('1');
    expect(screen.getByLabelText('Непрочитанных: 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Календарь' })).not.toHaveTextContent(/\d/);
  });

  test('shows no count while nothing waits', () => {
    render(<Sidebar email="manager.test@example.com" />);

    expect(screen.queryByLabelText(/Непрочитанных/)).not.toBeInTheDocument();
  });
});
