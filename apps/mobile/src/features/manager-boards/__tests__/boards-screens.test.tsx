import { localDay } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { BoardsTab } from '../boards-tab';
import { CardScreen } from '../card-screen';
import {
  boardCardSchema,
  boardSchema,
  cardDetailSchema,
  type Board,
  type BoardCard,
  type BoardViewer,
  type CardDetail,
} from '../schema';

/**
 * «Доски» on the office's phone (docs/manager-boards.md): the boards one tap
 * each, a column at a time with its quick add, the summary and the archive;
 * the card's own screen with its column buttons, steps, the offer of
 * «Выполнено» and the journal — and another manager reads all of it without
 * a single lever.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'f1a2b3c4-1111-4111-8111-f1a2b3c40001' }));
jest.mock('@/features/properties/use-properties', () => ({
  useReportProperties: () => ({ data: [], isPending: false }),
}));

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const READER = 'aaaaaaaa-0000-4000-8000-000000000002';
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000003';
const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
const SECOND = 'b0a2d100-0000-4000-8000-000000000002';
const today = localDay();

function addDays(days: number): string {
  const [year, month, date] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

const board = (
  id: string,
  title: string,
  owner = OWNER,
  archived_at: string | null = null,
): Board =>
  boardSchema.parse({
    id,
    title,
    owner_id: owner,
    archived_at,
    created_at: '2026-11-01T10:00:00Z',
    owner: { full_name: 'Ольга' },
  });

const card = (n: number, overrides: Partial<BoardCard> = {}): BoardCard =>
  boardCardSchema.parse({
    id: `b0a2d200-0000-4000-8000-00000000000${n}`,
    board_id: BOARD,
    title: `Карточка ${n}`,
    description: '',
    column_key: 'open',
    color: null,
    due_on: null,
    property_id: null,
    created_at: `2026-11-0${n}T10:00:00Z`,
    moved_at: `2026-11-0${n}T10:00:00Z`,
    archived_at: null,
    deleted_at: null,
    property: null,
    steps: [],
    ...overrides,
  });

const CARDS = [
  card(1, {
    title: 'Ремонт ванной',
    color: 'blue',
    due_on: addDays(-2),
    steps: [
      { id: 's1', body: 'Плитка', done_at: 'x' },
      { id: 's2', body: 'Краска', done_at: null },
    ],
  }),
  card(2, { title: 'Звонок юристу', due_on: today }),
  card(3, { title: 'Закупка', column_key: 'in_progress' }),
  card(4, { title: 'Старое', archived_at: '2026-11-10T10:00:00Z' }),
];

const DETAIL: CardDetail = cardDetailSchema.parse({
  ...CARDS[0],
  description: 'План: https://example.com/plan',
  created_by: OWNER,
  creator: { full_name: 'Ольга' },
  steps: [
    { id: 's1', body: 'Плитка', sort_order: 1, done_at: 'x' },
    { id: 's2', body: 'Краска', sort_order: 2, done_at: 'y' },
  ],
  entries: [
    {
      id: 'e1',
      kind: 'moved',
      body: null,
      facts: { from: 'open', to: 'assigned' },
      author_id: OWNER,
      created_at: '2026-11-11T09:00:00Z',
      edited_at: null,
      author: { full_name: 'Ольга' },
    },
    {
      id: 'e2',
      kind: 'comment',
      body: 'Мастер придёт во вторник',
      facts: {},
      author_id: OWNER,
      created_at: '2026-11-12T09:00:00Z',
      edited_at: '2026-11-12T10:00:00Z',
      author: { full_name: 'Ольга' },
    },
  ],
});

const mockState: {
  viewer: BoardViewer;
  boards: Board[];
  cards: BoardCard[];
  detail: CardDetail | null;
} = {
  viewer: { id: OWNER, isAdmin: false },
  boards: [board(BOARD, 'Проекты'), board(SECOND, 'Закупки', READER)],
  cards: CARDS,
  detail: DETAIL,
};

const mockSpies = {
  saveCard: jest.fn(),
  move: jest.fn(),
  shelve: jest.fn(),
  tick: jest.fn(),
  saveComment: jest.fn(),
  archiveBoard: jest.fn(),
};

function mockMutation(spy: jest.Mock) {
  return {
    isPending: false,
    isError: false,
    error: null,
    reset: jest.fn(),
    mutate: (variables: unknown, options?: { onSuccess?: () => void }) => {
      spy(variables);
      options?.onSuccess?.();
    },
  };
}

jest.mock('../use-boards', () => ({
  useViewer: () => mockState.viewer,
  useBoards: () => ({
    isPending: false,
    isError: false,
    data: mockState.boards,
    refetch: jest.fn(),
  }),
  useBoardCards: () => ({
    isPending: false,
    isError: false,
    isRefetching: false,
    data: mockState.cards,
    refetch: jest.fn(),
  }),
  useCard: () => ({ isPending: false, isError: false, data: mockState.detail, refetch: jest.fn() }),
  useSaveCard: () => mockMutation(mockSpies.saveCard),
  useMoveCard: () => mockMutation(mockSpies.move),
  useSetCardShelf: () => mockMutation(mockSpies.shelve),
  useSetBoardArchived: () => mockMutation(mockSpies.archiveBoard),
  useSaveBoard: () => mockMutation(jest.fn()),
  useDuplicateCard: () => mockMutation(jest.fn()),
  useSaveStep: () => mockMutation(jest.fn()),
  useSetStepDone: () => mockMutation(mockSpies.tick),
  useDeleteStep: () => mockMutation(jest.fn()),
  useOrderSteps: () => mockMutation(jest.fn()),
  useSaveComment: () => mockMutation(mockSpies.saveComment),
  useDeleteComment: () => mockMutation(jest.fn()),
}));

beforeEach(() => {
  mockState.viewer = { id: OWNER, isAdmin: false };
  mockState.boards = [board(BOARD, 'Проекты'), board(SECOND, 'Закупки', READER)];
  mockState.cards = CARDS;
  mockState.detail = DETAIL;
  jest.clearAllMocks();
});

describe('the boards tab', () => {
  test('the boards one tap each, the first one open, its column «Открыто» first', async () => {
    await render(<BoardsTab />);
    expect(screen.getByRole('tab', { name: 'Проекты' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Закупки' })).toBeOnTheScreen();
    expect(screen.getByText('Ремонт ванной')).toBeOnTheScreen();
    expect(screen.getByText('Звонок юристу')).toBeOnTheScreen();
    expect(screen.queryByText('Закупка')).toBeNull();
    expect(screen.queryByText('Старое')).toBeNull();
  });

  test('what is late and due today, and the colour said by name', async () => {
    await render(<BoardsTab />);
    expect(screen.getByRole('button', { name: 'Просрочено: 1' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Срок сегодня: 1' })).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Ремонт ванной\. Синий\./)).toBeOnTheScreen();
  });

  test('another column, and a card opens on its own screen', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('tab', { name: /^В работе/ }));
    await fireEvent.press(screen.getByLabelText(/^Закупка/));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/board-card/[id]',
      params: { id: CARDS[2].id },
    });
  });

  test('the quick add puts a card in the column shown', async () => {
    await render(<BoardsTab />);
    const field = screen.getByLabelText('Новая карточка в колонке «Открыто»');
    await fireEvent.changeText(field, 'Позвонить электрику');
    await fireEvent(field, 'submitEditing');
    expect(mockSpies.saveCard).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: BOARD,
        column: 'open',
        fields: {
          title: 'Позвонить электрику',
          description: '',
          dueOn: null,
          propertyId: null,
          color: null,
        },
      }),
    );
  });

  test('the archive lists the shelved cards with «Вернуть»', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('tab', { name: /^Архив/ }));
    expect(screen.getByText('Старое')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Вернуть' }));
    expect(mockSpies.shelve).toHaveBeenCalledWith({ cardId: CARDS[3].id, shelf: 'active' });
  });

  test("another manager's board is read only: no quick add, no board menu", async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Закупки' }));
    expect(
      screen.getByText('Только просмотр: менять доску может её владелец или админ.'),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText(/Новая карточка в колонке/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Действия с доской' })).toBeNull();
  });

  test('no boards yet: a word and «Новая доска»', async () => {
    mockState.boards = [];
    await render(<BoardsTab />);
    expect(
      screen.getByText('Досок пока нет. Создайте доску для своих дел: проекты, звонки, закупки.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Новая доска' })).toBeOnTheScreen();
  });
});

describe('the card screen', () => {
  test('the column as buttons, moved by a tap', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'В работе' }));
    expect(mockSpies.move).toHaveBeenCalledWith({ cardId: DETAIL.id, column: 'in_progress' });
  });

  test('with every step ticked it offers «Выполнено», and moves only when asked', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(
      screen.getByText('Все шаги отмечены. Перенести карточку в «Выполнено»?'),
    ).toBeOnTheScreen();
    expect(mockSpies.move).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Перенести' }));
    expect(mockSpies.move).toHaveBeenCalledWith({ cardId: DETAIL.id, column: 'resolved' });
  });

  test('a tick goes to its function', async () => {
    mockState.detail = cardDetailSchema.parse({
      ...DETAIL,
      steps: [{ id: 's2', body: 'Краска', sort_order: 1, done_at: null }],
    });
    await render(<CardScreen cardId={DETAIL.id} />);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Краска' }));
    expect(mockSpies.tick).toHaveBeenCalledWith({ stepId: 's2', done: true });
  });

  test('the journal: the system line in words, the comment with «изменено», a new comment sent', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByText('Перемещена в колонку «Назначено»')).toBeOnTheScreen();
    expect(screen.getByText(/Ольга · .* · изменено/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Комментарий'), 'Готово к пятнице');
    await fireEvent.press(screen.getByRole('button', { name: 'Добавить' }));
    expect(mockSpies.saveComment).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: DETAIL.id, body: 'Готово к пятнице' }),
    );
  });

  test('another manager reads the card without a lever', async () => {
    mockState.viewer = { id: READER, isAdmin: false };
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.queryByRole('radio', { name: 'В работе' })).toBeNull();
    expect(screen.queryByLabelText('Комментарий')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Дублировать' })).toBeNull();
    expect(screen.queryByText(/Все шаги отмечены/)).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeDisabled();
    }
  });

  test("an admin changes anybody's card", async () => {
    mockState.viewer = { id: ADMIN, isAdmin: true };
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByRole('button', { name: 'Дублировать' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Комментарий')).toBeOnTheScreen();
  });

  test('a card nobody may see is «not found»', async () => {
    mockState.detail = null;
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByText('Карточка не найдена')).toBeOnTheScreen();
  });

  test('the link in the description is a link', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByRole('link', { name: 'https://example.com/plan' })).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: /План/ })).toBeNull();
  });
});
