import { render, screen } from '@testing-library/react-native';

import ArticleRoute from '@/app/knowledge/article/[id]';
import PlaceKnowledgeRoute from '@/app/knowledge/place/[id]';

import type { KbArticle } from '../schema';

/**
 * The routes of the knowledge base: a link from a card, a list or anywhere
 * else is read through its schema, and a malformed one never crashes a screen.
 */

const mockParams = { id: '' as string | string[] };
const mockSession = { userId: 'me' as string | null, isLoading: false };

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>{`redirect to ${href}`}</Text>;
  },
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/auth/session', () => ({ useSession: () => mockSession }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));

const mockArticle: KbArticle = {
  id: '11111111-1111-4111-8111-111111111111',
  scope: 'company',
  language: 'ru',
  title: 'Правила',
  body: 'Обувь снимаем.',
  updated_at: '2026-10-17T08:00:00Z',
  targets: [],
  translations: [],
};

const mockIdle = {
  isPending: false,
  isError: false,
  isRefetching: false,
  error: null,
  refetch: jest.fn(),
};
const mockPlace = jest.fn();

jest.mock('../use-knowledge', () => ({
  useKbArticles: () => ({ ...mockIdle, data: [mockArticle] }),
  useKbPlace: (id: number | null) => {
    mockPlace(id);
    return { ...mockIdle, data: null };
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.userId = 'me';
});

describe('«Инструкции объекта»', () => {
  test.each([['abc'], ['0'], ['-5'], ['1.5'], [['1', '2']]])(
    'a malformed place %j says there is nothing, and asks for nothing',
    async (id) => {
      mockParams.id = id;

      await render(<PlaceKnowledgeRoute />);

      expect(screen.getByText('Для этого объекта статей нет')).toBeOnTheScreen();
      expect(mockPlace).not.toHaveBeenCalled();
    },
  );

  test('a place by its number is asked for by that number', async () => {
    mockParams.id = '412432';

    await render(<PlaceKnowledgeRoute />);

    expect(mockPlace).toHaveBeenCalledWith(412432);
  });
});

describe('one article', () => {
  test('a malformed id reads as an article that is gone', async () => {
    mockParams.id = 'not-a-uuid';

    await render(<ArticleRoute />);

    expect(screen.getByText(/Статья не найдена/)).toBeOnTheScreen();
  });

  test('an article by its id opens', async () => {
    mockParams.id = mockArticle.id;

    await render(<ArticleRoute />);

    expect(screen.getByRole('header', { name: 'Правила' })).toBeOnTheScreen();
  });

  test('nobody signed in is sent to sign in', async () => {
    mockSession.userId = null;
    mockParams.id = mockArticle.id;

    await render(<ArticleRoute />);

    expect(screen.getByText('redirect to /sign-in')).toBeOnTheScreen();
  });
});
