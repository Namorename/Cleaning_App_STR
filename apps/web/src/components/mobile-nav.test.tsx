import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks',
}));

// A plain anchor: a press on Next's own link would ask for the app router,
// which a test has not got. What is under test is that the sheet closes.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const unread = { tasks: new Set<string>(), problems: new Set<string>() };
vi.mock('@/features/chat/use-chat', () => ({ useUnreadSubjects: () => unread }));

afterEach(() => {
  unread.tasks.clear();
  unread.problems.clear();
});

import { MobileNav } from './mobile-nav';

const ROUTES = [
  '/dashboard',
  '/calendar',
  '/tasks',
  '/problems',
  '/supplies',
  '/apartments',
  '/team',
  '/settings',
];

async function openSheet(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: /Открыть меню/ }));
  return screen.findByRole('dialog', { name: 'Разделы' });
}

/**
 * The panel on a phone (the owner's decision 14): the side menu gives its
 * width to the page, and a top bar opens the same menu in a sheet.
 */
describe('MobileNav', () => {
  test('a top bar holds the logo’s mark and the button of a closed menu', () => {
    render(<MobileNav email="manager.test@example.com" />);

    expect(screen.getByRole('button', { name: /Открыть меню/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    for (const logo of screen.getAllByRole('img', { name: 'woom' })) {
      expect(logo.getAttribute('src')).toMatch(/^\/brand\/logo-mark-(light|dark)\./);
    }
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  test('the button opens the same menu in a sheet and moves the focus into it', async () => {
    render(<MobileNav email="manager.test@example.com" />);

    const sheet = await openSheet();
    const nav = within(sheet).getByRole('navigation', { name: 'Разделы' });

    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(
      ROUTES,
    );
    expect(within(nav).getByRole('group', { name: 'Работа' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Уборки' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sheet).getByText('manager.test@example.com')).toBeInTheDocument();
    await waitFor(() => expect(sheet).toContainElement(document.activeElement as HTMLElement));
  });

  test('Escape closes the sheet and gives the focus back to the button', async () => {
    render(<MobileNav email="manager.test@example.com" />);
    const button = screen.getByRole('button', { name: /Открыть меню/ });
    await openSheet();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('the sheet has its own way to close, by name', async () => {
    render(<MobileNav email="manager.test@example.com" />);
    const sheet = await openSheet();

    await userEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('choosing a section closes the sheet', async () => {
    render(<MobileNav email="manager.test@example.com" />);
    const sheet = await openSheet();

    await userEvent.click(within(sheet).getByRole('link', { name: 'Календарь' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('a waiting conversation shows on the closed menu’s button', () => {
    unread.tasks.add('a');
    unread.problems.add('b');
    render(<MobileNav email="manager.test@example.com" />);

    expect(screen.getByRole('button', { name: /Открыть меню/ })).toHaveAccessibleName(
      /Непрочитанных: 2/,
    );
  });
});

// Night of 2026-10-10: on a phone the lever is in the same menu, under the sections.
test('the menu on a phone offers the night theme on a lever', async () => {
  render(<MobileNav email="manager.test@example.com" theme="dark" />);

  const sheet = await openSheet();

  expect(within(sheet).getByRole('switch', { name: 'Тёмная тема' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
