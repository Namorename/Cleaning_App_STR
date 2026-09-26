import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { deviceLanguage, i18n } from '@/i18n';

import { ProfileLanguageGate } from '../language-gate';
import { profileKeys } from '../keys';

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

/**
 * Drawn and settled: the render is awaited, so the gate's first effect has run
 * inside `act` rather than racing the assertions that follow. gcTime Infinity
 * schedules no collection timer: with the default five minutes, the unmounted
 * profile query held the process open and this file, run on its own, never
 * exited.
 */
async function renderGate(): Promise<QueryClient> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <ProfileLanguageGate>
        <Somewhere />
      </ProfileLanguageGate>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  session.userId = null;
  language.value = null;
});

// The language is one i18next instance for the whole file, and every test
// here changes it. Handing the phone back to its own locale after each one —
// the tree is unmounted by then — keeps the next test from starting in the
// language the last one chose.
afterEach(async () => {
  await i18n.changeLanguage(deviceLanguage());
});

test('a signed-in cleaner reads the language her profile carries', async () => {
  session.userId = 'u1';
  language.value = 'en';

  await renderGate();

  await waitFor(() => expect(screen.getByText('Sign in')).toBeTruthy());
  expect(i18n.language).toBe('en');
});

test('the whole tree follows, not just the screen that asked', async () => {
  session.userId = 'u1';
  language.value = 'cs';

  await renderGate();

  // `Somewhere` knows nothing about profiles or sessions: it is subscribed to
  // the language and that is enough, which is what makes this a change of the
  // whole interface rather than of one screen.
  await waitFor(() => expect(screen.getByText('Přihlásit se')).toBeTruthy());
});

// Right after a test that switched to Czech: this is what the afterEach buys.
test('the next test starts from the device locale, whatever the one before chose', () => {
  expect(i18n.language).toBe('ru');
});

test('a profile with no language of its own leaves the device locale alone', async () => {
  session.userId = 'u1';
  language.value = null;

  const client = await renderGate();

  // Russian is on screen before the profile answers, so waiting for the text
  // alone proved nothing. Wait for the answer, then look.
  await waitFor(() =>
    expect(client.getQueryState(profileKeys.language('u1'))?.status).toBe('success'),
  );
  expect(screen.getByText('Войти')).toBeTruthy();
  expect(i18n.language).toBe('ru');
});

test('nobody signed in reads the phone, not the last person who was', async () => {
  await i18n.changeLanguage('en');
  session.userId = null;

  await renderGate();

  // jest.setup fixes the device locale to Russian, so this is the phone
  // speaking — and it is what the next cleaner on a shared phone should see.
  await waitFor(() => expect(i18n.language).toBe('ru'));
});
