import type { Session } from '@supabase/supabase-js';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { applyWordContext, i18n, wordContext } from '@/i18n';

import { SessionProvider, useSession } from '../session';

/**
 * A technician reads «работа» where a cleaner reads «уборка» (docs/tech-plan.md
 * §6): the `_tech` variant of a key, through i18next's context. The words are
 * the reader's, like her language, so the session applies them the moment it
 * knows who she is — before any screen draws her session — and takes them back
 * when she leaves, so the next person on a shared phone does not inherit them.
 */

type AuthListener = (event: string, next: Session | null) => void;

const mockAuth: { stored: Session | null; listener: AuthListener | null } = {
  stored: null,
  listener: null,
};

jest.mock('@/lib/supabase', () => ({
  SESSION_STORAGE_KEY: 'sb-project-auth-token',
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockAuth.stored } }),
      onAuthStateChange: (listener: AuthListener) => {
        mockAuth.listener = listener;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));

jest.mock('@/features/push/api', () => ({
  releaseThisPhone: jest.fn(),
  clearThisPhone: jest.fn(),
}));
jest.mock('@/features/push/registration', () => ({ registerThisPhone: jest.fn() }));
jest.mock('@/features/push/token-store', () => ({
  registrant: jest.fn(() => null),
  unmarkRegistered: jest.fn(),
}));

function sessionAs(role: string | undefined): Session {
  return {
    access_token: 'token',
    user: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', app_metadata: role ? { role } : {} },
  } as unknown as Session;
}

/** What a screen under the provider reads on its first draw with her session. */
function FirstWords() {
  const { session } = useSession();
  return session === null ? null : (
    <Text>{i18n.t('tasks.startFailed', { context: wordContext() })}</Text>
  );
}

beforeEach(() => {
  mockAuth.stored = null;
  mockAuth.listener = null;
  applyWordContext(undefined);
});

afterAll(() => {
  applyWordContext(undefined);
});

test('a technician’s session is read in his words from the first draw', async () => {
  // Arrange
  mockAuth.stored = sessionAs('tech');

  // Act
  await render(
    <SessionProvider>
      <FirstWords />
    </SessionProvider>,
  );

  // Assert
  expect(await screen.findByText('Не удалось начать работу — обновите список.')).toBeTruthy();
  expect(wordContext()).toBe('tech');
});

test('the head technician reads the same words as the technician', async () => {
  mockAuth.stored = sessionAs('head_tech');

  await render(
    <SessionProvider>
      <FirstWords />
    </SessionProvider>,
  );

  await waitFor(() => expect(wordContext()).toBe('tech'));
});

test.each(['cleaner', 'manager', 'auditor', undefined])(
  'a session of role %s reads the cleaner’s words',
  async (role) => {
    mockAuth.stored = sessionAs(role);

    await render(
      <SessionProvider>
        <FirstWords />
      </SessionProvider>,
    );

    expect(await screen.findByText('Не удалось начать уборку — обновите список.')).toBeTruthy();
    expect(wordContext()).toBeUndefined();
  },
);

test('signing out takes his words back; the next person signs in with her own', async () => {
  // Arrange: a technician is signed in.
  mockAuth.stored = sessionAs('tech');
  await render(
    <SessionProvider>
      <FirstWords />
    </SessionProvider>,
  );
  await waitFor(() => expect(wordContext()).toBe('tech'));

  // Act: he leaves.
  await act(async () => mockAuth.listener?.('SIGNED_OUT', null));

  // Assert
  expect(wordContext()).toBeUndefined();

  // Act: a cleaner signs in on the same phone.
  await act(async () => mockAuth.listener?.('SIGNED_IN', sessionAs('cleaner')));

  // Assert
  expect(await screen.findByText('Не удалось начать уборку — обновите список.')).toBeTruthy();
  expect(wordContext()).toBeUndefined();
});

/**
 * A screen as every screen reads its words: through i18next, not through the
 * session. Drawn as a child of the provider, it is not drawn again when the
 * session changes — only when the words do.
 */
function ScreenWords() {
  const { t } = useTranslation();
  return <Text>{t('tasks.loading', { context: wordContext() })}</Text>;
}

test('a screen already drawn turns to his words when the office makes him a technician', async () => {
  // Arrange: a cleaner's screen is up.
  mockAuth.stored = sessionAs('cleaner');
  await render(
    <SessionProvider>
      <ScreenWords />
    </SessionProvider>,
  );
  expect(await screen.findByText('Загружаем уборки…')).toBeTruthy();

  // Act: the refreshed token says he is a technician now.
  await act(async () => mockAuth.listener?.('TOKEN_REFRESHED', sessionAs('tech')));

  // Assert
  expect(await screen.findByText('Загружаем работы…')).toBeTruthy();
  expect(screen.queryByText('Загружаем уборки…')).toBeNull();
});

test('and back, when he is a cleaner again', async () => {
  mockAuth.stored = sessionAs('tech');
  await render(
    <SessionProvider>
      <ScreenWords />
    </SessionProvider>,
  );
  expect(await screen.findByText('Загружаем работы…')).toBeTruthy();

  await act(async () => mockAuth.listener?.('TOKEN_REFRESHED', sessionAs('cleaner')));

  expect(await screen.findByText('Загружаем уборки…')).toBeTruthy();
});

test('a role changed by the office arrives with the refreshed token', async () => {
  mockAuth.stored = sessionAs('cleaner');
  await render(
    <SessionProvider>
      <FirstWords />
    </SessionProvider>,
  );
  await screen.findByText('Не удалось начать уборку — обновите список.');

  await act(async () => mockAuth.listener?.('TOKEN_REFRESHED', sessionAs('tech')));

  expect(await screen.findByText('Не удалось начать работу — обновите список.')).toBeTruthy();
});
