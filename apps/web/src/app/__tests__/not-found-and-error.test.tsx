import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { expectPageTitle } from '@/components/page-header.expect';
import { LANGUAGE_COOKIE } from '@/lib/language';

// The request's cookies, as the server pages read them.
const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
  }),
}));

afterEach(() => {
  cookieJar.clear();
});

import RootError from '../error';
import RootNotFound from '../not-found';
import MissingPage from '../(panel)/[...missing]/page';
import PanelError from '../(panel)/error';
import PanelNotFound from '../(panel)/not-found';

/**
 * docs/redesign-plan.md §2.4: a wrong address showed Next's own English 404,
 * and a page that threw showed Next's own error. Both are the panel's pages
 * now — in the manager's language, in the panel's theme, with a way back.
 */
describe('the panel’s 404', () => {
  test('says the page is not there, with the way to the dashboard', async () => {
    render(await PanelNotFound());

    expectPageTitle('Страница не найдена');
    expect(
      screen.getByText('Такой страницы в панели нет: адрес набран с ошибкой или ссылка устарела.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'На дашборд' })).toHaveAttribute('href', '/dashboard');
  });

  test('speaks the language the manager chose, read on the server', async () => {
    cookieJar.set(LANGUAGE_COOKIE, 'cs');

    render(await PanelNotFound());

    expectPageTitle('Stránka nenalezena');
    expect(screen.getByRole('link', { name: 'Na přehled' })).toHaveAttribute('href', '/dashboard');
  });

  test('an address the panel has no page for is that 404, inside the panel', () => {
    let thrown: unknown;
    try {
      MissingPage();
    } catch (error) {
      thrown = error;
    }

    // notFound(): Next renders the nearest not-found — the panel's, in its shell.
    expect((thrown as { digest?: string } | undefined)?.digest).toMatch(/404/);
  });

  test('outside the shell, the same page stands under the logo', async () => {
    cookieJar.set(LANGUAGE_COOKIE, 'en');

    render(await RootNotFound());

    expectPageTitle('Page not found');
    expect(screen.getAllByRole('img', { name: 'woom' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'To the dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });
});

describe('the panel’s error page', () => {
  const failure = (message: string, digest?: string) =>
    Object.assign(new Error(message), digest === undefined ? {} : { digest });

  test('leads with the panel’s words, the error’s own small under them, and its code', () => {
    const error = failure('Cannot read properties of undefined', '4242');
    render(<PanelError error={error} retry={vi.fn()} />);

    expectPageTitle('Страница не открылась');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось показать экран. Попробуйте ещё раз.');
    expect(screen.getByText('Cannot read properties of undefined')).toHaveClass('text-xs');
    expect(screen.getByText('Код ошибки: 4242')).toBeInTheDocument();
  });

  test('an error without words or code shows the sentence alone', () => {
    render(<PanelError error={failure('')} retry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Не удалось показать экран\. Попробуйте ещё раз\.$/,
    );
    expect(screen.queryByText(/Код ошибки/)).not.toBeInTheDocument();
  });

  test('tries the page again on a press', async () => {
    const retry = vi.fn();
    render(<PanelError error={failure('boom')} retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  test('leads back to the dashboard', () => {
    render(<PanelError error={failure('boom')} retry={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'На дашборд' })).toHaveAttribute('href', '/dashboard');
  });

  test('outside the shell, the same page stands under the logo', () => {
    render(<RootError error={failure('boom')} retry={vi.fn()} />);

    expectPageTitle('Страница не открылась');
    expect(screen.getAllByRole('img', { name: 'woom' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
