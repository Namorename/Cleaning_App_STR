import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { i18n } from '@/i18n';

import { ProfileLanguageGate } from '../language-gate';

/**
 * The manager chooses a language in the panel; until now the phone never
 * asked. It read the device locale once, at startup, and stayed there — so a
 * cleaner given English kept getting Russian, because Russian is what her
 * phone is set to.
 *
 * What is asserted here is the whole chain: her row decides, the change
 * reaches a component that never heard of profiles, and signing out hands the
 * phone back to its own locale rather than to the previous cleaner's language.
 */

const session = { userId: null as string | null };
jest.mock('@/features/auth/session', () => ({
  useSession: () => session,
}));

const language = { value: null as string | null };
jest.mock('../api', () => ({
  fetchMyLanguage: jest.fn(async () => ({ id: 'u1', preferred_language: language.value })),
}));

/** A component with no idea any of this exists — it only shows a translation. */
function Somewhere() {
  const { t } = useTranslation();
  return <Text>{t('auth.submit')}</Text>;
}

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfileLanguageGate>
        <Somewhere />
      </ProfileLanguageGate>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  session.userId = null;
  language.value = null;
  await i18n.changeLanguage('ru');
});

test('a signed-in cleaner reads the language her profile carries', async () => {
  session.userId = 'u1';
  language.value = 'en';

  renderGate();

  await waitFor(() => expect(screen.getByText('Sign in')).toBeTruthy());
  expect(i18n.language).toBe('en');
});

test('the whole tree follows, not just the screen that asked', async () => {
  session.userId = 'u1';
  language.value = 'cs';

  renderGate();

  // `Somewhere` knows nothing about profiles or sessions: it is subscribed to
  // the language and that is enough, which is what makes this a change of the
  // whole interface rather than of one screen.
  await waitFor(() => expect(screen.getByText('Přihlásit se')).toBeTruthy());
});

test('a profile with no language of its own leaves the device locale alone', async () => {
  session.userId = 'u1';
  language.value = null;

  renderGate();

  await waitFor(() => expect(screen.getByText('Войти')).toBeTruthy());
  expect(i18n.language).toBe('ru');
});

test('nobody signed in reads the phone, not the last person who was', async () => {
  await i18n.changeLanguage('en');
  session.userId = null;

  renderGate();

  // jest.setup fixes the device locale to Russian, so this is the phone
  // speaking — and it is what the next cleaner on a shared phone should see.
  await waitFor(() => expect(i18n.language).toBe('ru'));
});
