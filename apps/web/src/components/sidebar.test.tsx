import { ICONS, type IconMeaning } from '@str-ops/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { SIDEBAR_COOKIE } from '@/lib/sidebar-state';

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

// Base UI's tooltip does not finish opening under jsdom: one opening, by a
// hover or by the keyboard's focus, blocked the worker for minutes — a plain
// tooltip of ui/tooltip as much as the menu's. What the strip promises is
// held on a stand-in instead: each row carries its name into a tooltip that
// is on only in the strip. The opening itself is the library's, and the
// preview's to look at.
vi.mock('@/components/ui/tooltip', async () => {
  const { cloneElement, createContext, useContext } = await import('react');
  const IsOff = createContext(false);
  return {
    TooltipProvider: ({ children }: { children: ReactNode }) => children,
    Tooltip: ({ disabled = false, children }: { disabled?: boolean; children: ReactNode }) => (
      <IsOff.Provider value={disabled}>{children}</IsOff.Provider>
    ),
    TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
      cloneElement(render, undefined, children),
    TooltipContent: ({ children }: { children: ReactNode }) =>
      useContext(IsOff) ? null : <span role="tooltip">{children}</span>,
  };
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

/**
 * The owner's shell, variant A (docs/design/decisions.md §2): the menu folds
 * to a strip of icons. The names leave the screen but not the links, each icon
 * says its name in a tooltip, and the group labels give way to a separator
 * (the proposal of §4).
 */
describe('Sidebar folded to a strip of icons', () => {
  afterEach(() => {
    document.cookie = `${SIDEBAR_COOKIE}=; Path=/; Max-Age=0`;
  });

  test('the toggle says the menu is open, and folds it with every name kept for a reader', async () => {
    render(<Sidebar email="manager.test@example.com" />);
    const toggle = screen.getByRole('button', { name: 'Свернуть меню' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('link', { name: 'Уборки' })).getByText('Уборки')).not.toHaveClass(
      'sr-only',
    );

    await userEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Развернуть меню' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('complementary')).toHaveAttribute('data-state', 'collapsed');
    // Out of sight, still the links' names.
    const names = ['Дашборд', 'Календарь', 'Уборки', 'Задания', 'Заявки', 'Объекты', 'Команда'];
    for (const name of [...names, 'Настройки']) {
      const link = screen.getByRole('link', { name });
      expect(within(link).getByText(name)).toHaveClass('sr-only');
    }
  });

  test('the group labels give way to a separator, the groups keep their names', async () => {
    render(<Sidebar email="manager.test@example.com" isInitiallyCollapsed />);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });

    expect(within(nav).queryByText('Работа')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Справочники')).not.toBeInTheDocument();
    expect(within(nav).getByRole('group', { name: 'Работа' })).toBeInTheDocument();
    expect(within(nav).getByRole('group', { name: 'Справочники' })).toBeInTheDocument();
    expect(within(nav).getAllByRole('separator')).toHaveLength(1);
  });

  test('each icon, and the toggle, tells its name in a tooltip', () => {
    render(<Sidebar email="manager.test@example.com" isInitiallyCollapsed />);

    expect(screen.getAllByRole('tooltip').map((tip) => tip.textContent)).toEqual([
      'Дашборд',
      'Календарь',
      'Уборки',
      'Задания',
      'Заявки',
      'Объекты',
      'Команда',
      'Настройки',
      // The theme lever (night of 2026-10-10), above the toggle.
      'Тёмная тема',
      'Развернуть меню',
    ]);
  });

  test('the open menu needs no tooltips: its names are on screen', () => {
    render(<Sidebar email="manager.test@example.com" />);

    expect(screen.queryAllByRole('tooltip')).toEqual([]);
  });

  test('the strip shows the logo’s mark and leaves the address to Settings', () => {
    render(<Sidebar email="manager.test@example.com" isInitiallyCollapsed />);

    for (const logo of screen.getAllByRole('img', { name: 'woom' })) {
      expect(logo.getAttribute('src')).toMatch(/^\/brand\/logo-mark-(light|dark)\./);
    }
    expect(screen.queryByText('manager.test@example.com')).not.toBeInTheDocument();
  });

  test('a waiting conversation still shows its count on the folded icon', () => {
    unread.tasks.add('a');
    render(<Sidebar email="manager.test@example.com" isInitiallyCollapsed />);

    expect(screen.getByLabelText('Непрочитанных: 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Уборки/ })).toHaveTextContent('1');
  });

  test('the keyboard reaches the toggle and works it', async () => {
    render(<Sidebar email="manager.test@example.com" />);
    const toggle = screen.getByRole('button', { name: 'Свернуть меню' });

    // Through the eight sections and the theme lever, then the toggle under them.
    for (let step = 0; step < 10 && document.activeElement !== toggle; step += 1) {
      await userEvent.tab();
    }
    expect(toggle).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Развернуть меню' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('remembers the choice in the cookie the layout reads for the next page', async () => {
    render(<Sidebar email="manager.test@example.com" />);

    await userEvent.click(screen.getByRole('button', { name: 'Свернуть меню' }));
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);

    await userEvent.click(screen.getByRole('button', { name: 'Развернуть меню' }));
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=expanded`);
  });

  test('opens at the width it was left at, as the server drew it', () => {
    render(<Sidebar email="manager.test@example.com" isInitiallyCollapsed />);

    expect(screen.getByRole('button', { name: 'Развернуть меню' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('complementary')).toHaveAttribute('data-state', 'collapsed');
  });

  test('draws the toggle’s two states from the shared map', async () => {
    render(<Sidebar email="manager.test@example.com" />);
    const toggle = screen.getByRole('button', { name: 'Свернуть меню' });
    expect(toggle.querySelector('svg')).toHaveClass(`lucide-${ICONS['nav.collapse']}`);

    await userEvent.click(toggle);

    expect(
      screen.getByRole('button', { name: 'Развернуть меню' }).querySelector('svg'),
    ).toHaveClass(`lucide-${ICONS['nav.expand']}`);
  });
});

// Night of 2026-10-10: the day and the night theme a press away, in the menu.
describe('Sidebar and the theme', () => {
  test('the open menu offers the night theme on a lever, by its name', () => {
    render(<Sidebar email="manager.test@example.com" theme="light" />);

    expect(screen.getByRole('switch', { name: 'Тёмная тема' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByText('Тёмная тема')).toBeInTheDocument();
  });

  test('the folded strip keeps the lever, its name in a tooltip', () => {
    render(<Sidebar email="manager.test@example.com" theme="dark" isInitiallyCollapsed />);

    expect(screen.getByRole('switch', { name: 'Тёмная тема' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
