import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';
import { LANGUAGE_COOKIE } from '@/lib/language';

const api = vi.hoisted(() => ({ saveMyLanguage: vi.fn() }));
vi.mock('../api', () => api);
const CLIENT = { name: 'the browser client' };
vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => CLIENT }));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LanguageSwitcher } from '../language-switcher';

const USER = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

function renderSwitcher() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageSwitcher userId={USER} />
    </QueryClientProvider>,
  );
}

const choice = (name: string) => screen.getByRole('combobox', { name });

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.lang = 'ru';
});

afterEach(async () => {
  // The dictionary is one instance for the whole run: the next file reads Russian.
  await i18n.changeLanguage('ru');
  document.cookie = `${LANGUAGE_COOKIE}=; Path=/; Max-Age=0`;
  document.documentElement.lang = '';
});

describe('LanguageSwitcher', () => {
  test('offers the three languages, each in its own words, starting from the one on screen', () => {
    renderSwitcher();

    expect(choice('Язык')).toHaveValue('ru');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Русский',
      'English',
      'Čeština',
    ]);
  });

  test('a choice is saved to the profile first, then kept in the cookie and the panel redrawn', async () => {
    api.saveMyLanguage.mockResolvedValue(undefined);
    renderSwitcher();

    await userEvent.selectOptions(choice('Язык'), 'en');

    expect(api.saveMyLanguage).toHaveBeenCalledTimes(1);
    expect(api.saveMyLanguage).toHaveBeenCalledWith(CLIENT, USER, 'en');
    // Redrawn in place: the label is already English.
    expect(await screen.findByRole('combobox', { name: 'Language' })).toHaveValue('en');
    expect(document.cookie).toContain(`${LANGUAGE_COOKIE}=en`);
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.language).toBe('en');
    // The server's half — <html lang>, the pages it renders — follows the cookie.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a refused save is said in the panel’s words, and nothing is half-changed', async () => {
    api.saveMyLanguage.mockRejectedValue({ message: 'permission denied', code: '42501' });
    renderSwitcher();

    await userEvent.selectOptions(choice('Язык'), 'cs');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Язык не сменился.');
    expect(alert).toHaveTextContent('Не удалось выполнить действие. Попробуйте ещё раз.');
    // The server's own words only under it, small, to forward to whoever fixes it.
    expect(alert).toHaveTextContent('permission denied');
    await waitFor(() => expect(choice('Язык')).toHaveValue('ru'));
    expect(document.cookie).not.toContain(`${LANGUAGE_COOKIE}=cs`);
    expect(document.documentElement.lang).toBe('ru');
    expect(i18n.language).toBe('ru');
    expect(refresh).not.toHaveBeenCalled();
  });

  test('the language already on screen is not sent again', async () => {
    renderSwitcher();

    await userEvent.selectOptions(choice('Язык'), 'ru');

    expect(api.saveMyLanguage).not.toHaveBeenCalled();
  });

  // The reviewer, 10.10: a select made `disabled` under the hand drops the
  // focus to the page; it says it is busy instead, and keeps the focus.
  test('says it is saving while the profile is written, keeps the focus, and takes no second choice then', async () => {
    let finish: () => void = () => undefined;
    api.saveMyLanguage.mockImplementation(
      () => new Promise<void>((resolve) => (finish = () => resolve())),
    );
    renderSwitcher();
    await userEvent.click(choice('Язык'));

    await userEvent.selectOptions(choice('Язык'), 'en');

    expect(await screen.findByRole('status')).toHaveTextContent('Сохраняем…');
    expect(choice('Язык')).toHaveAttribute('aria-disabled', 'true');
    expect(choice('Язык')).toBeEnabled();
    expect(choice('Язык')).toHaveFocus();
    // The choice stays shown while it is on its way, and a second one is not sent.
    expect(choice('Язык')).toHaveValue('en');
    await userEvent.selectOptions(choice('Язык'), 'cs');
    expect(choice('Язык')).toHaveValue('en');
    expect(api.saveMyLanguage).toHaveBeenCalledTimes(1);

    finish();
    const settled = await screen.findByRole('combobox', { name: 'Language' });
    await waitFor(() => expect(settled).not.toHaveAttribute('aria-disabled'));
    expect(settled).toHaveFocus();
  });

  // The reviewer, 10.10: the panel changed only if the switcher was still on
  // screen when the profile answered. The profile has the choice by then, so
  // the panel follows it wherever the manager has gone meanwhile.
  test('a save that lands after the switcher has left still changes the panel', async () => {
    let finish: () => void = () => undefined;
    api.saveMyLanguage.mockImplementation(
      () => new Promise<void>((resolve) => (finish = () => resolve())),
    );
    const { unmount } = renderSwitcher();
    await userEvent.selectOptions(choice('Язык'), 'en');
    await screen.findByRole('status');

    unmount();
    finish();

    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(document.cookie).toContain(`${LANGUAGE_COOKIE}=en`);
    expect(document.documentElement.lang).toBe('en');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
