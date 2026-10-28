import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { PlaceInstructions } from '../place-instructions';
import type { KbArticle, KbPlace } from '../schema';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));

const ROOM: KbPlace = {
  id: 1000000066011,
  name: 'Room one',
  parent_id: 900066010,
  hostaway_unit_id: 66011,
  parent: { name: 'The house' },
};

function article(id: string, propertyId: number): KbArticle {
  return {
    id,
    scope: 'properties',
    language: 'ru',
    title: `Статья ${id}`,
    body: 'Текст.',
    updated_at: '2026-10-17T08:00:00Z',
    targets: [{ property_id: propertyId, property: null }],
    translations: [],
  };
}

const idle = { isPending: false, isError: false, error: null };
const mockState = {
  articles: { ...idle, data: [] as KbArticle[] | undefined } as Record<string, unknown>,
  place: { ...idle, data: ROOM as KbPlace | null | undefined } as Record<string, unknown>,
};

jest.mock('../use-knowledge', () => ({
  useKbArticles: () => mockState.articles,
  useKbPlace: () => mockState.place,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState.articles = {
    ...idle,
    data: [article('a', ROOM.id), article('b', 900066010), article('c', 42)],
  };
  mockState.place = { ...idle, data: ROOM };
});

test('says how many articles the place has, the house’s included, and opens them', async () => {
  await render(<PlaceInstructions propertyId={ROOM.id} />);

  const block = screen.getByRole('button', { name: /Инструкции объекта/ });
  expect(screen.getByText('2 статьи')).toBeOnTheScreen();
  await fireEvent.press(block);

  expect(router.push).toHaveBeenCalledWith({
    pathname: '/knowledge/place/[id]',
    params: { id: String(ROOM.id) },
  });
});

test.each([
  ['while it loads', { isPending: true, isError: false, error: null, data: undefined }],
  [
    'when the cloud has no knowledge base yet',
    { isPending: false, isError: true, error: { code: 'PGRST205' }, data: undefined },
  ],
  [
    'when the network failed',
    {
      isPending: false,
      isError: true,
      error: new TypeError('Network request failed'),
      data: undefined,
    },
  ],
])('draws nothing %s: the card stays as it was', async (_name, articles) => {
  mockState.articles = articles;

  await render(<PlaceInstructions propertyId={ROOM.id} />);

  expect(screen.queryByText(/Инструкции объекта/)).toBeNull();
});

test('draws nothing for a place with no articles', async () => {
  mockState.articles = { ...idle, data: [article('c', 42)] };

  await render(<PlaceInstructions propertyId={ROOM.id} />);

  expect(screen.queryByText(/Инструкции объекта/)).toBeNull();
});

test('draws nothing when the place itself cannot be read', async () => {
  mockState.place = { ...idle, data: null };

  await render(<PlaceInstructions propertyId={ROOM.id} />);

  expect(screen.queryByText(/Инструкции объекта/)).toBeNull();
});

test('draws nothing for a report without a place', async () => {
  await render(<PlaceInstructions propertyId={null} />);

  expect(screen.queryByText(/Инструкции объекта/)).toBeNull();
});
