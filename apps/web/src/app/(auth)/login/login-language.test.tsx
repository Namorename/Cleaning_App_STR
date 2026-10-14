import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';
import { LANGUAGE_COOKIE, languageFromCookie } from '@/lib/language';

vi.mock('./actions', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { Providers } from '../../providers';
import LoginPage from './page';

/**
 * The sign-in page as the root layout serves it: the dictionary in the
 * language of the `lang` cookie the request carried — none for a guest.
 */
async function renderSignIn(cookie: string | undefined) {
  const page = await LoginPage({ searchParams: Promise.resolve({}) });
  return render(<Providers language={languageFromCookie(cookie)}>{page}</Providers>);
}

const switcher = () => screen.getByRole('group', { name: /^(Language|Jazyk|Язык)$/ });

afterEach(async () => {
  // The dictionary is one instance per file: the next test starts from the setup's.
  await i18n.changeLanguage('ru');
  document.cookie = `${LANGUAGE_COOKIE}=; Path=/; Max-Age=0`;
  document.documentElement.lang = '';
});

/**
 * The owner's decision of 14.10: the sign-in screen opens in English for
 * anybody who has not chosen otherwise, on any device, and offers the other
 * two languages right there. The choice is the `lang` cookie, the same one the
 * sign-in later fills from the profile.
 */
describe('the sign-in page’s language', () => {
  test('a guest with no cookie reads the sign-in in English', async () => {
    await renderSignIn(undefined);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByText('Manager panel')).toBeInTheDocument();
  });

  test('a cookie `ru` reads it in Russian', async () => {
    await renderSignIn('ru');

    expect(screen.getByLabelText('Эл. почта')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled();
  });

  test('a cookie `cs` reads it in Czech', async () => {
    await renderSignIn('cs');

    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přihlásit se' })).toBeEnabled();
  });

  test('offers the three languages, each in its own words, English first, the one on screen pressed', async () => {
    await renderSignIn(undefined);

    const buttons = within(switcher()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['English', 'Čeština', 'Русский']);
    expect(buttons.map((button) => button.getAttribute('lang'))).toEqual(['en', 'cs', 'ru']);
    expect(within(switcher()).getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(switcher()).getByRole('button', { name: 'Русский' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('a choice is kept in the `lang` cookie and redraws the card at once', async () => {
    await renderSignIn(undefined);

    await userEvent.click(within(switcher()).getByRole('button', { name: 'Čeština' }));

    expect(document.cookie).toContain(`${LANGUAGE_COOKIE}=cs`);
    expect(document.documentElement.lang).toBe('cs');
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přihlásit se' })).toBeEnabled();
    expect(within(switcher()).getByRole('button', { name: 'Čeština' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('Russian can be chosen too, and back to English', async () => {
    await renderSignIn(undefined);

    await userEvent.click(within(switcher()).getByRole('button', { name: 'Русский' }));
    expect(await screen.findByLabelText('Эл. почта')).toBeInTheDocument();
    expect(document.cookie).toContain(`${LANGUAGE_COOKIE}=ru`);

    await userEvent.click(within(switcher()).getByRole('button', { name: 'English' }));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(document.cookie).toContain(`${LANGUAGE_COOKIE}=en`);
  });

  test('the language switcher is no submit button of the sign-in form', async () => {
    await renderSignIn(undefined);

    for (const button of within(switcher()).getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });
});
