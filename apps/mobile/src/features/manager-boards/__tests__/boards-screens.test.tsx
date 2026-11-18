import { localDay } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { BoardsTab } from '../boards-tab';
import { CardScreen } from '../card-screen';
import {
  boardCardSchema,
  boardSchema,
  cardDetailSchema,
  myCardSchema,
  type Board,
  type BoardCard,
  type BoardViewer,
  type CardDetail,
  type MyCard,
  type OfficePerson,
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
jest.mock('expo-crypto', () => {
  let minted = 0;
  return {
    randomUUID: () => {
      minted += 1;
      return `f1a2b3c4-1111-4111-8111-${String(minted).padStart(12, '0')}`;
    },
  };
});
jest.mock('@/features/properties/use-properties', () => ({
  useReportProperties: () => ({ data: [], isPending: false }),
}));
jest.mock('@/features/board/use-board', () => ({
  useStaffDirectory: () => ({ data: mockState.staff, isPending: false }),
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
  /** The last read failed, what was read before it still in hand. */
  isStale: boolean;
  /** The writes the server refuses. */
  failing: Set<jest.Mock>;
  /** The company's directory: who a card can be given to, and who the journal names. */
  staff: OfficePerson[];
  /** «Назначено мне». */
  mine: MyCard[];
} = {
  viewer: { id: OWNER, isAdmin: false },
  boards: [board(BOARD, 'Проекты'), board(SECOND, 'Закупки', READER)],
  cards: CARDS,
  detail: DETAIL,
  isStale: false,
  failing: new Set(),
  staff: [],
  mine: [],
};

const STAFF: OfficePerson[] = [
  { id: OWNER, full_name: 'Ольга', role: 'manager', is_active: true },
  { id: READER, full_name: 'Ира', role: 'manager', is_active: true },
  { id: ADMIN, full_name: 'Анна', role: 'admin', is_active: true },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000009',
    full_name: 'Вера',
    role: 'cleaner',
    is_active: true,
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000008',
    full_name: 'Пётр',
    role: 'manager',
    is_active: false,
  },
];

const mockSpies = {
  saveCard: jest.fn(),
  move: jest.fn(),
  shelve: jest.fn(),
  tick: jest.fn(),
  saveComment: jest.fn(),
  archiveBoard: jest.fn(),
  assign: jest.fn(),
};

function mockMutation(spy: jest.Mock) {
  return {
    isPending: false,
    isError: false,
    error: null,
    reset: jest.fn(),
    mutate: (
      variables: unknown,
      options?: { onSuccess?: () => void; onError?: (error: unknown) => void },
    ) => {
      spy(variables);
      if (mockState.failing.has(spy)) {
        options?.onError?.({ message: 'lost' });
      } else {
        options?.onSuccess?.();
      }
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
  useCard: () => ({
    isPending: false,
    isError: mockState.isStale,
    error: mockState.isStale ? new Error('offline') : null,
    data: mockState.detail,
    refetch: jest.fn(),
  }),
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
  useSetCardAssignee: () => mockMutation(mockSpies.assign),
  useMyCards: () => ({
    isPending: false,
    isError: false,
    isRefetching: false,
    data: mockState.mine,
    refetch: jest.fn(),
  }),
}));

beforeEach(() => {
  mockState.viewer = { id: OWNER, isAdmin: false };
  mockState.boards = [board(BOARD, 'Проекты'), board(SECOND, 'Закупки', READER)];
  mockState.cards = CARDS;
  mockState.detail = DETAIL;
  mockState.isStale = false;
  mockState.failing = new Set();
  mockState.staff = STAFF;
  mockState.mine = [];
  jest.clearAllMocks();
});

describe('after the review of the phone', () => {
  test('a refresh that fails keeps the card read before, under a banner', async () => {
    mockState.isStale = true;
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByText('Ремонт ванной')).toBeOnTheScreen();
    expect(screen.getByText(/^Не удалось обновить доску/)).toBeOnTheScreen();
  });

  test('a column or a journal line a later server adds leaves the screens readable', async () => {
    mockState.detail = cardDetailSchema.parse({
      ...DETAIL,
      column_key: 'waiting',
      entries: [...DETAIL.entries, { ...DETAIL.entries[0], id: 'e9', kind: 'reminded', facts: {} }],
    });
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByText('Ремонт ванной')).toBeOnTheScreen();
    expect(screen.getByText('Мастер придёт во вторник')).toBeOnTheScreen();
  });

  test('a quick add refused once is asked again under the same id; other words, another id', async () => {
    mockState.failing.add(mockSpies.saveCard);
    await render(<BoardsTab />);
    const field = screen.getByLabelText('Новая карточка в колонке «Открыто»');
    await fireEvent.changeText(field, 'Позвонить');
    await fireEvent(field, 'submitEditing');
    await fireEvent(field, 'submitEditing');
    await fireEvent.changeText(field, 'Позвонить электрику');
    await fireEvent(field, 'submitEditing');
    const ids = mockSpies.saveCard.mock.calls.map(
      ([variables]) => (variables as { cardId: string }).cardId,
    );
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });
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

  test('what is late and due today; the colour is the stripe, never named', async () => {
    await render(<BoardsTab />);
    expect(screen.getByRole('button', { name: 'Просрочено: 1' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Срок сегодня: 1' })).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Ремонт ванной\. Просрочено/)).toBeOnTheScreen();
    expect(screen.queryByText(/Синий/, { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByLabelText(/Синий/)).toBeNull();
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

  test("another manager's board: the quick add and the cards are hers too, the board menu is not, and not a word about why", async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Закупки' }));
    expect(screen.queryByText(/владел|админ|просмотр|менять/i)).toBeNull();
    expect(screen.getByLabelText('Новая карточка в колонке «Открыто»')).toBeOnTheScreen();
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

  test('the due date is picked on the month grid and saved with the fields', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));
    const day = addDays(5);
    if (day.slice(0, 7) !== DETAIL.due_on?.slice(0, 7)) {
      await fireEvent.press(screen.getByLabelText(/следующий месяц/i));
    }
    await fireEvent.press(screen.getByTestId(`month-grid-day-${day}`));
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveCard).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cardId: DETAIL.id,
        fields: expect.objectContaining({ dueOn: day }),
      }),
    );
  });

  test('«Убрать срок» saves a card without one', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Убрать срок' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveCard).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ dueOn: null }) }),
    );
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

  test('another manager changes the card as its owner does', async () => {
    mockState.viewer = { id: READER, isAdmin: false };
    await render(<CardScreen cardId={DETAIL.id} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'В работе' }));
    expect(mockSpies.move).toHaveBeenCalledWith({ cardId: DETAIL.id, column: 'in_progress' });
    expect(screen.getByLabelText('Комментарий')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Дублировать' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'В архив' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Исполнитель:/ })).toBeOnTheScreen();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeEnabled();
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

describe('the assignee and the colour (20261118230000)', () => {
  const NOT_ON_SCREEN = /владел|админ|только для просмотра|чтобы менять/i;

  test('the card screen shows the colour as a stripe, never by name; the picker names its circles to a reader only', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.queryByText(/Синий|Цвет:/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));
    expect(screen.getByRole('radio', { name: 'Синий' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Без цвета' })).toBeOnTheScreen();
    expect(screen.queryByText('Синий')).toBeNull();
    expect(screen.queryByText('Без цвета')).toBeNull();
  });

  test('the colour filter is circles too, named to a reader only', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('button', { name: 'Фильтры' }));
    expect(screen.getByRole('checkbox', { name: 'Синий' })).toBeOnTheScreen();
    expect(screen.queryByText('Синий')).toBeNull();
  });

  test('another manager reads a card with no word about who may change it', async () => {
    mockState.viewer = { id: READER, isAdmin: false };
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.queryByText(NOT_ON_SCREEN)).toBeNull();
  });

  test('a shelved card says only what it is', async () => {
    mockState.viewer = { id: READER, isAdmin: false };
    mockState.detail = cardDetailSchema.parse({ ...DETAIL, archived_at: '2026-11-15T10:00:00Z' });
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByText('Карточка в архиве')).toBeOnTheScreen();
    expect(screen.queryByText(NOT_ON_SCREEN)).toBeNull();
  });

  test('a card on the board says who works on it', async () => {
    mockState.cards = [
      card(1, { title: 'Ремонт ванной', assignee_id: READER, assignee: { full_name: 'Ира' } }),
    ];
    await render(<BoardsTab />);
    expect(screen.getByText('Исполнитель: Ира')).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Ремонт ванной\..*Исполнитель: Ира$/)).toBeOnTheScreen();
  });

  test('the owner gives the card to an active manager or admin from a sheet, or to nobody', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Без исполнителя' }));
    expect(screen.getByRole('button', { name: 'Анна' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Вера' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Пётр' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Ира' }));
    expect(mockSpies.assign).toHaveBeenCalledWith({ cardId: DETAIL.id, assigneeId: READER });
  });

  test('the assignee works on her card on a board not hers and assigns, copies and shelves it, as every manager', async () => {
    mockState.viewer = { id: READER, isAdmin: false };
    mockState.detail = cardDetailSchema.parse({
      ...DETAIL,
      assignee_id: READER,
      assignee: { full_name: 'Ира' },
    });
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByLabelText('Комментарий')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Исполнитель: Ира' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Дублировать' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'В архив' })).toBeOnTheScreen();
  });

  test('the journal says who the card went to, by the names of the directory', async () => {
    mockState.detail = cardDetailSchema.parse({
      ...DETAIL,
      entries: [
        ...DETAIL.entries,
        {
          ...DETAIL.entries[0],
          id: 'e7',
          kind: 'assignee_changed',
          facts: { from: OWNER, to: READER },
          created_at: '2026-11-13T09:00:00Z',
        },
      ],
    });
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByText('Исполнитель изменён: Ольга → Ира')).toBeOnTheScreen();
  });

  test('the filter by assignee puts «Назначено мне» first and narrows the board', async () => {
    mockState.cards = [
      card(1, { title: 'Ремонт ванной', assignee_id: READER, assignee: { full_name: 'Ира' } }),
      card(2, { title: 'Звонок юристу', assignee_id: OWNER, assignee: { full_name: 'Ольга' } }),
    ];
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('button', { name: 'Фильтры' }));
    const chips = screen.getAllByRole('radio').map((chip) => chip.props.accessibilityLabel);
    const everyone = chips.indexOf('Все');
    expect(chips.slice(everyone, everyone + 3)).toEqual([
      'Все',
      'Назначено мне',
      'Без исполнителя',
    ]);
    await fireEvent.press(screen.getByRole('radio', { name: 'Назначено мне' }));
    expect(screen.getByText('Звонок юристу')).toBeOnTheScreen();
    expect(screen.queryByText('Ремонт ванной')).toBeNull();
  });

  test('«Назначено мне» lists her cards of every board, each naming its board', async () => {
    mockState.mine = [
      myCardSchema.parse({
        ...card(1, { title: 'Ремонт ванной', assignee_id: OWNER }),
        board: { id: BOARD, title: 'Проекты', owner_id: OWNER, archived_at: null },
      }),
      myCardSchema.parse({
        ...card(2, { title: 'Купить лампы', board_id: SECOND, assignee_id: OWNER }),
        board: { id: SECOND, title: 'Закупки', owner_id: READER, archived_at: null },
      }),
    ];
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Назначено мне' }));
    expect(screen.getByText('Доска «Проекты»')).toBeOnTheScreen();
    expect(screen.getByText('Доска «Закупки»')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/Новая карточка в колонке/)).toBeNull();
    await fireEvent.press(screen.getByLabelText(/^Купить лампы/));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/board-card/[id]',
      params: { id: mockState.mine[1].id },
    });
  });

  test('«Назначено мне» with nothing given to her says so', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Назначено мне' }));
    expect(screen.getByText('Вам пока не назначено ни одной карточки')).toBeOnTheScreen();
  });
});

describe('after the review of the phone, stage 2', () => {
  test('«Назначено мне» comes first among the boards', async () => {
    await render(<BoardsTab />);
    expect(screen.getAllByRole('tab')[0]).toHaveAccessibleName('Назначено мне');
  });

  test('a card saved to disk by the build before the assignee reads with nobody', () => {
    const { assignee_id: _id, assignee: _person, ...old } = card(1);
    const parsed = boardCardSchema.parse(old);
    expect([parsed.assignee_id, parsed.assignee]).toEqual([null, null]);
  });

  test('the assignee cannot be picked before the people are read', async () => {
    mockState.staff = undefined as unknown as OfficePerson[];
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByRole('button', { name: 'Исполнитель: Без исполнителя' })).toBeDisabled();
  });
});

describe('the board itself (20261119090000)', () => {
  test('its own form says who renames and archives it', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('button', { name: 'Действия с доской' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Переименовать' }));
    expect(
      screen.getByText(
        'Переименовать доску и убрать её в архив может только её владелец или админ.',
      ),
    ).toBeOnTheScreen();
  });
});
