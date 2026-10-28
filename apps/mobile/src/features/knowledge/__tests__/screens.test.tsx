import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ArticleScreen } from '../article-screen';
import { KnowledgeScreen } from '../knowledge-screen';
import { PlaceKnowledgeScreen } from '../place-knowledge-screen';
import type { KbArticle, KbPlace } from '../schema';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));

const HOUSE_ID = 900066010;
const ROOM: KbPlace = {
  id: 1000000066011,
  name: 'Room one',
  parent_id: HOUSE_ID,
  hostaway_unit_id: 66011,
  parent: { name: 'The house' },
};

function article(overrides: Partial<KbArticle>): KbArticle {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    scope: 'properties',
    language: 'ru',
    title: 'Статья',
    body: 'Текст.',
    updated_at: '2026-10-17T08:00:00Z',
    targets: [],
    translations: [],
    ...overrides,
  };
}

const BOILER = article({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Котёл',
  body: 'Кнопка **справа**, у двери.',
  targets: [{ property_id: ROOM.id, property: { parent_id: HOUSE_ID } }],
});
const BINS = article({
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Мусор',
  body: 'Контейнеры во дворе.',
  scope: 'building',
  targets: [{ property_id: HOUSE_ID, property: { parent_id: null } }],
});
const RULES = article({
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Правила компании',
  body: 'Обувь снимаем.',
  scope: 'company',
});
const CZECH_ONLY = article({
  id: '44444444-4444-4444-8444-444444444444',
  language: 'cs',
  title: 'Klíče',
  body: 'Klíče jsou v krabičce.',
  scope: 'company',
});

const idle = {
  isPending: false,
  isError: false,
  isRefetching: false,
  error: null,
  refetch: jest.fn(),
};

/** The platform's pull to refresh, as the lists of the phone draw it. */
const pulls = () => screen.container.queryAll((node) => node.type === 'RCTRefreshControl');

const REFRESH_FAILED = 'Не удалось обновить, показано сохранённое. Потяните вниз, чтобы повторить.';
const mockState = {
  articles: {} as Record<string, unknown>,
  place: {} as Record<string, unknown>,
};

jest.mock('../use-knowledge', () => ({
  useKbArticles: () => mockState.articles,
  useKbPlace: () => mockState.place,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState.articles = { ...idle, data: [BOILER, BINS, RULES, CZECH_ONLY] };
  mockState.place = { ...idle, data: ROOM };
});

describe('«База знаний»: every article the reader may read', () => {
  test('lists them and opens one', async () => {
    await render(<KnowledgeScreen />);

    expect(screen.getByText('Котёл')).toBeOnTheScreen();
    expect(screen.getByText('Правила компании')).toBeOnTheScreen();
    expect(screen.getByText('Кнопка справа, у двери.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Мусор'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/knowledge/article/[id]',
      params: { id: BINS.id },
    });
  });

  test('searches the titles and the text on the phone', async () => {
    await render(<KnowledgeScreen />);

    await fireEvent.changeText(screen.getByLabelText('Поиск по статьям'), 'двор');

    expect(screen.getByText('Мусор')).toBeOnTheScreen();
    expect(screen.queryByText('Котёл')).toBeNull();
  });

  test('says so when nothing matches', async () => {
    await render(<KnowledgeScreen />);

    await fireEvent.changeText(screen.getByLabelText('Поиск по статьям'), 'пылесос');

    expect(screen.getByText('Ничего не нашлось')).toBeOnTheScreen();
  });

  test('an empty base says so plainly', async () => {
    mockState.articles = { ...idle, data: [] };

    await render(<KnowledgeScreen />);

    expect(screen.getByText('Статей пока нет')).toBeOnTheScreen();
  });

  test('a cloud without the knowledge base yet reads as an empty one, not a failure', async () => {
    mockState.articles = {
      ...idle,
      isError: true,
      error: { code: 'PGRST205', message: 'Could not find the table' },
      data: undefined,
    };

    await render(<KnowledgeScreen />);

    expect(screen.getByText('Статей пока нет')).toBeOnTheScreen();
    expect(screen.queryByText(/Не удалось загрузить статьи/)).toBeNull();
  });

  test('a failed load says what to do, and tries again', async () => {
    const refetch = jest.fn();
    mockState.articles = {
      ...idle,
      isError: true,
      error: new TypeError('Network request failed'),
      data: undefined,
      refetch,
    };

    await render(<KnowledgeScreen />);

    expect(screen.getByText(/Не удалось загрузить статьи/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(refetch).toHaveBeenCalled();
  });

  test('says it is loading', async () => {
    mockState.articles = { ...idle, isPending: true, data: undefined };

    await render(<KnowledgeScreen />);

    expect(screen.getByLabelText('Загружаем статьи…')).toBeOnTheScreen();
  });
});

describe('the instructions of one place', () => {
  test('its own and its house’s, under its name, and a way to all the rest', async () => {
    await render(<PlaceKnowledgeScreen propertyId={ROOM.id} />);

    expect(screen.getByText('The house — Room one')).toBeOnTheScreen();
    expect(screen.getByText('Котёл')).toBeOnTheScreen();
    expect(screen.getByText('Мусор')).toBeOnTheScreen();
    expect(screen.queryByText('Правила компании')).toBeNull();

    await fireEvent.press(screen.getByText('Все статьи базы знаний'));
    expect(router.push).toHaveBeenCalledWith('/knowledge');
  });

  test('a place without articles says so', async () => {
    mockState.articles = { ...idle, data: [RULES] };

    await render(<PlaceKnowledgeScreen propertyId={ROOM.id} />);

    expect(screen.getByText('Для этого объекта статей нет')).toBeOnTheScreen();
  });
});

describe('one article', () => {
  test('its title and text in the phone’s language', async () => {
    await render(<ArticleScreen articleId={BOILER.id} />);

    expect(screen.getByRole('header', { name: 'Котёл' })).toBeOnTheScreen();
    expect(screen.getByText('справа')).toBeOnTheScreen();
    expect(screen.queryByText(/показан оригинал/)).toBeNull();
  });

  test('the author’s language, said, when there is no translation into the phone’s', async () => {
    await render(<ArticleScreen articleId={CZECH_ONLY.id} />);

    expect(screen.getByRole('header', { name: 'Klíče' })).toBeOnTheScreen();
    expect(screen.getByText(/показан оригинал/)).toBeOnTheScreen();
  });

  test('one that is gone, or no longer the reader’s, says so', async () => {
    await render(<ArticleScreen articleId="55555555-5555-4555-8555-555555555555" />);

    expect(screen.getByText(/Статья не найдена/)).toBeOnTheScreen();
  });

  test('says it is loading', async () => {
    mockState.articles = { ...idle, isPending: true, data: undefined };

    await render(<ArticleScreen articleId={BOILER.id} />);

    expect(screen.getByLabelText('Загружаем статьи…')).toBeOnTheScreen();
  });

  test('a failed load says what to do, and tries again', async () => {
    const refetch = jest.fn();
    mockState.articles = {
      ...idle,
      isError: true,
      error: new TypeError('Network request failed'),
      data: undefined,
      refetch,
    };

    await render(<ArticleScreen articleId={BOILER.id} />);

    expect(screen.getByText(/Не удалось загрузить статьи/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(refetch).toHaveBeenCalled();
  });

  test('a cloud without the knowledge base yet reads as an article that is gone', async () => {
    mockState.articles = {
      ...idle,
      isError: true,
      error: { code: 'PGRST205', message: 'Could not find the table' },
      data: undefined,
    };

    await render(<ArticleScreen articleId={BOILER.id} />);

    expect(screen.getByText(/Статья не найдена/)).toBeOnTheScreen();
  });
});

describe('the instructions of one place, when things go wrong', () => {
  test('says it is loading', async () => {
    mockState.place = { ...idle, isPending: true, data: undefined };

    await render(<PlaceKnowledgeScreen propertyId={ROOM.id} />);

    expect(screen.getByLabelText('Загружаем статьи…')).toBeOnTheScreen();
  });

  test('a failed load of the place says so, and asks both again', async () => {
    const articlesAgain = jest.fn();
    const placeAgain = jest.fn();
    mockState.articles = { ...idle, data: [BOILER], refetch: articlesAgain };
    mockState.place = {
      ...idle,
      isError: true,
      error: new TypeError('Network request failed'),
      data: undefined,
      refetch: placeAgain,
    };

    await render(<PlaceKnowledgeScreen propertyId={ROOM.id} />);

    expect(screen.getByText(/Не удалось загрузить статьи/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(articlesAgain).toHaveBeenCalled();
    expect(placeAgain).toHaveBeenCalled();
  });

  test('a cloud without the knowledge base yet reads as a place without articles', async () => {
    mockState.articles = {
      ...idle,
      isError: true,
      error: { code: 'PGRST205', message: 'Could not find the table' },
      data: undefined,
    };

    await render(<PlaceKnowledgeScreen propertyId={ROOM.id} />);

    expect(screen.getByText('Для этого объекта статей нет')).toBeOnTheScreen();
  });

  test('a place she may not read has no instructions, and no name', async () => {
    mockState.place = { ...idle, data: null };

    await render(<PlaceKnowledgeScreen propertyId={ROOM.id} />);

    expect(screen.getByText('Для этого объекта статей нет')).toBeOnTheScreen();
    expect(screen.queryByText('The house — Room one')).toBeNull();
  });
});

describe('a refresh that failed over what is on screen', () => {
  test('the list says so, keeps its rows, and a pull asks again', async () => {
    const refetch = jest.fn();
    mockState.articles = {
      ...idle,
      isError: true,
      error: new TypeError('Network request failed'),
      data: [BOILER],
      refetch,
    };

    await render(<KnowledgeScreen />);

    expect(screen.getByText(REFRESH_FAILED)).toBeOnTheScreen();
    expect(screen.getByText('Котёл')).toBeOnTheScreen();
    expect(pulls()).toHaveLength(1);
    await fireEvent(pulls()[0], 'refresh');
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test('a place’s list asks both its reads again on a pull', async () => {
    const articlesAgain = jest.fn();
    const placeAgain = jest.fn();
    mockState.articles = { ...idle, data: [BOILER], refetch: articlesAgain };
    mockState.place = { ...idle, data: ROOM, refetch: placeAgain };

    await render(<PlaceKnowledgeScreen propertyId={ROOM.id} />);
    await fireEvent(pulls()[0], 'refresh');

    expect(articlesAgain).toHaveBeenCalledTimes(1);
    expect(placeAgain).toHaveBeenCalledTimes(1);
  });

  test('an article says so, keeps its text, and a pull asks again', async () => {
    const refetch = jest.fn();
    mockState.articles = {
      ...idle,
      isError: true,
      error: new TypeError('Network request failed'),
      data: [BOILER],
      refetch,
    };

    await render(<ArticleScreen articleId={BOILER.id} />);

    expect(screen.getByText(REFRESH_FAILED)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Котёл' })).toBeOnTheScreen();
    await fireEvent(pulls()[0], 'refresh');
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
