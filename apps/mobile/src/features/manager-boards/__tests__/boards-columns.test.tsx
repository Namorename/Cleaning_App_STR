import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { BoardsTab } from '../boards-tab';
import { CardScreen } from '../card-screen';
import {
  boardCardSchema,
  boardColumnSchema,
  boardSchema,
  cardDetailSchema,
  myCardSchema,
  type Board,
  type BoardCard,
  type BoardViewer,
  type CardDetail,
  type ColumnRow,
  type MyCard,
  type OfficePerson,
} from '../schema';

/**
 * A board's own columns on the phone (20261126120000): the panes are the board's live columns by
 * their names; a card stands in its column by id — or, cached by the build before, by its stage —
 * moves by id and is offered the board's first finishing column; the journal names a column by
 * its id, renamed or deleted. «Назначено мне» stays by the four stages; a card on a board she does
 * not see is «Закрытая доска», worked on without the board's own actions.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-crypto', () => {
  let minted = 0;
  return {
    randomUUID: () => {
      minted += 1;
      return `f1a2b3c4-2222-4222-8222-${String(minted).padStart(12, '0')}`;
    },
  };
});
jest.mock('@/features/properties/use-properties', () => ({
  useReportProperties: () => ({ data: [], isPending: false }),
}));
jest.mock('@/features/board/use-board', () => ({
  useStaffDirectory: () => ({ data: mockStaff, isPending: false }),
}));

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const READER = 'aaaaaaaa-0000-4000-8000-000000000002';
const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
const SECOND = 'b0a2d100-0000-4000-8000-000000000002';
const OPEN = 'c01a2b3c-0000-4000-8000-000000000001';
const WAITING = 'c01a2b3c-0000-4000-8000-000000000005';
const DONE = 'c01a2b3c-0000-4000-8000-000000000006';
const GONE = 'c01a2b3c-0000-4000-8000-000000000007';

const mockStaff: OfficePerson[] = [
  { id: OWNER, full_name: 'Ольга', role: 'manager', is_active: true },
  { id: READER, full_name: 'Ира', role: 'manager', is_active: true },
];

// No `shared`: a board cached by the build before visibility reads as shared.
const board = (id: string, title: string, owner = OWNER, archived_at: string | null = null) =>
  boardSchema.parse({
    id,
    title,
    owner_id: owner,
    archived_at,
    created_at: '2026-11-01T10:00:00Z',
    owner: { full_name: 'Ольга' },
  });

const column = (overrides: Partial<ColumnRow> & Pick<ColumnRow, 'id'>): ColumnRow =>
  boardColumnSchema.parse({
    board_id: BOARD,
    title: null,
    preset: null,
    position: 1,
    is_done: false,
    legacy_key: 'open',
    deleted_at: null,
    ...overrides,
  });

/** A board of its own: «Открыто» kept from the four, two named columns, one deleted. */
const COLUMNS: ColumnRow[] = [
  column({ id: OPEN, preset: 'open', position: 1 }),
  column({ id: WAITING, title: 'Ждёт ответа', position: 2, legacy_key: 'in_progress' }),
  column({ id: DONE, title: 'Сделано', position: 3, is_done: true, legacy_key: 'resolved' }),
  column({
    id: GONE,
    title: 'Старая',
    position: 2,
    legacy_key: 'assigned',
    deleted_at: '2026-11-20T10:00:00Z',
  }),
];

const card = (n: number, overrides: Record<string, unknown> = {}): BoardCard =>
  boardCardSchema.parse({
    id: `b0a2d200-0000-4000-8000-00000000000${n}`,
    board_id: BOARD,
    title: `Карточка ${n}`,
    description: '',
    column_id: OPEN,
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
  card(1, { title: 'Ремонт ванной' }),
  card(2, { title: 'Звонок юристу', column_id: WAITING, column_key: 'in_progress' }),
  card(3, { title: 'Закупка', column_id: DONE, column_key: 'resolved' }),
];

const DETAIL: CardDetail = cardDetailSchema.parse({
  ...CARDS[1],
  created_by: OWNER,
  creator: { full_name: 'Ольга' },
  steps: [{ id: 's1', body: 'Позвонить', sort_order: 1, done_at: '2026-11-12T09:00:00Z' }],
  entries: [
    {
      id: 'e1',
      kind: 'moved',
      body: null,
      facts: { from: 'open', to: 'assigned', from_column: OPEN, to_column: GONE },
      author_id: OWNER,
      created_at: '2026-11-10T09:00:00Z',
      edited_at: null,
      author: { full_name: 'Ольга' },
    },
    {
      id: 'e2',
      kind: 'moved',
      body: null,
      facts: { from: 'assigned', to: 'in_progress', from_column: GONE, to_column: WAITING },
      author_id: OWNER,
      created_at: '2026-11-11T09:00:00Z',
      edited_at: null,
      author: { full_name: 'Ольга' },
    },
  ],
});

const mockState: {
  viewer: BoardViewer;
  boards: Board[];
  cards: BoardCard[];
  /** Undefined: never read — the first open after the update, without signal. */
  columns: ColumnRow[] | undefined;
  detail: CardDetail | null;
  mine: MyCard[];
} = {
  viewer: { id: OWNER, isAdmin: false },
  boards: [],
  cards: [],
  columns: [],
  detail: null,
  mine: [],
};

/** The columns' read: what was read, or a failure with nothing read before it. */
function mockColumnsRead() {
  return mockState.columns === undefined
    ? {
        isPending: false,
        isError: true,
        isRefetching: false,
        error: new TypeError('Network request failed'),
        data: undefined,
        refetch: jest.fn(),
      }
    : mockRead(mockState.columns);
}

const mockSpies = { saveCard: jest.fn(), move: jest.fn(), shelve: jest.fn() };

function mockMutation(spy?: jest.Mock) {
  return {
    isPending: false,
    isError: false,
    error: null,
    reset: jest.fn(),
    mutate: (variables: unknown, options?: { onSuccess?: () => void }) => {
      spy?.(variables);
      options?.onSuccess?.();
    },
  };
}

function mockRead<T>(data: T) {
  return {
    isPending: false,
    isError: false,
    isRefetching: false,
    error: null,
    data,
    refetch: jest.fn(),
  };
}

jest.mock('../use-boards', () => ({
  useViewer: () => mockState.viewer,
  useBoards: () => mockRead(mockState.boards),
  useBoardCards: () => mockRead(mockState.cards),
  useBoardColumns: () => mockColumnsRead(),
  useCard: () => mockRead(mockState.detail),
  useMyCards: () => mockRead(mockState.mine),
  useSaveCard: () => mockMutation(mockSpies.saveCard),
  useMoveCard: () => mockMutation(mockSpies.move),
  useSetCardShelf: () => mockMutation(mockSpies.shelve),
  useSetBoardArchived: () => mockMutation(),
  useSaveBoard: () => mockMutation(),
  useTransferBoard: () => mockMutation(),
  useSaveColumn: () => mockMutation(),
  useOrderColumns: () => mockMutation(),
  useSetColumnDone: () => mockMutation(),
  useDeleteColumn: () => mockMutation(),
  useDuplicateCard: () => mockMutation(),
  useSaveStep: () => mockMutation(),
  useSetStepDone: () => mockMutation(),
  useDeleteStep: () => mockMutation(),
  useOrderSteps: () => mockMutation(),
  useSaveComment: () => mockMutation(),
  useDeleteComment: () => mockMutation(),
  useSetCardAssignee: () => mockMutation(),
}));

beforeEach(() => {
  mockState.viewer = { id: OWNER, isAdmin: false };
  mockState.boards = [board(BOARD, 'Проекты'), board(SECOND, 'Закупки', READER)];
  mockState.cards = CARDS;
  mockState.columns = COLUMNS;
  mockState.detail = DETAIL;
  mockState.mine = [];
  jest.clearAllMocks();
});

describe('the board: its own columns', () => {
  test('the panes are its live columns by their names, each card in its own', async () => {
    await render(<BoardsTab />);
    expect(screen.getByRole('tab', { name: 'Открыто 1' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Ждёт ответа 1' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Сделано 1' })).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: /^Старая/ })).toBeNull();
    expect(screen.getByText('Ремонт ванной')).toBeOnTheScreen();
    expect(screen.queryByText('Звонок юристу')).toBeNull();
    // A finishing column is done: the summary counts the other two.
    expect(screen.getByText('Открытых карточек: 2')).toBeOnTheScreen();
  });

  test('another column, and the quick add puts a card in it by its id', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('tab', { name: /^Ждёт ответа/ }));
    expect(screen.getByText('Звонок юристу')).toBeOnTheScreen();
    const field = screen.getByLabelText('Новая карточка в колонке «Ждёт ответа»');
    await fireEvent.changeText(field, 'Перезвонить');
    await fireEvent(field, 'submitEditing');
    expect(mockSpies.saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: BOARD, columnId: WAITING }),
    );
    expect(mockSpies.saveCard.mock.calls[0][0]).not.toHaveProperty('column');
  });

  test('columns never read, no signal: the cards read before show by stage, under a banner', async () => {
    mockState.columns = undefined;
    const view = await render(<BoardsTab />);
    expect(screen.getByText(/^Не удалось обновить доску/)).toBeOnTheScreen();
    for (const name of ['Открыто 1', 'Назначено 0', 'В работе 1', 'Выполнено 1']) {
      expect(screen.getByRole('tab', { name })).toBeOnTheScreen();
    }
    expect(screen.getByText('Ремонт ванной')).toBeOnTheScreen();
    // No card is made in a stage: only in a column, once the columns are read.
    expect(screen.queryByLabelText(/^Новая карточка в колонке/)).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'В работе 1' }));
    expect(screen.getByText('Звонок юристу')).toBeOnTheScreen();

    // The columns come: the stage chosen is its first column now, and the quick add is back.
    mockState.columns = COLUMNS;
    await view.rerender(<BoardsTab />);
    expect(screen.getByRole('tab', { name: 'Ждёт ответа 1' })).toBeSelected();
    expect(screen.getByText('Звонок юристу')).toBeOnTheScreen();
    expect(screen.getByLabelText('Новая карточка в колонке «Ждёт ответа»')).toBeOnTheScreen();
    expect(screen.queryByText(/^Не удалось обновить доску/)).toBeNull();
  });

  test('columns never read: the card names its stage and is not moved from it', async () => {
    mockState.columns = undefined;
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('В работе')).toBeOnTheScreen();
    expect(screen.queryByText(/^Все шаги отмечены/)).toBeNull();
  });

  test('a board and a card cached by the build before still read, the card by its stage', async () => {
    const { column_id: _column, ...old } = card(4, { title: 'Из кэша', column_key: 'in_progress' });
    mockState.cards = [boardCardSchema.parse(old)];
    await render(<BoardsTab />);
    expect(mockState.boards[0].shared).toBe(true);
    expect(screen.getByRole('tab', { name: 'Открыто 0' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Ждёт ответа 1' }));
    expect(screen.getByText('Из кэша')).toBeOnTheScreen();
  });
});

describe('the card screen', () => {
  test('the column buttons are the board’s live columns, its own chosen; a tap moves by id', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    const radios = screen.getAllByRole('radio').map((radio) => radio.props.accessibilityLabel);
    expect(radios).toEqual(['Открыто', 'Ждёт ответа', 'Сделано']);
    expect(screen.getByRole('radio', { name: 'Ждёт ответа' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Открыто' }));
    expect(mockSpies.move).toHaveBeenCalledWith({ cardId: DETAIL.id, column: COLUMNS[0] });
  });

  test('every step ticked: the board’s first finishing column is offered by its name', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(
      screen.getByText('Все шаги отмечены. Перенести карточку в «Сделано»?'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Перенести' }));
    expect(mockSpies.move).toHaveBeenCalledWith({ cardId: DETAIL.id, column: COLUMNS[2] });
  });

  test('a board without a finishing column offers nothing; nor does a card already in one', async () => {
    mockState.columns = COLUMNS.map((one) => ({ ...one, is_done: false }));
    const first = await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.queryByText(/^Все шаги отмечены/)).toBeNull();
    await first.unmount();

    mockState.columns = COLUMNS;
    mockState.detail = cardDetailSchema.parse({
      ...DETAIL,
      column_id: DONE,
      column_key: 'resolved',
    });
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.queryByText(/^Все шаги отмечены/)).toBeNull();
  });

  test('read only, the card names its column by its name', async () => {
    mockState.boards = [board(BOARD, 'Проекты', OWNER, '2026-11-15T10:00:00Z')];
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('Ждёт ответа')).toBeOnTheScreen();
  });

  test('the journal names a column by its id: a deleted one, a renamed one, by their names', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByText('Перемещена в колонку «Старая»')).toBeOnTheScreen();
    expect(screen.getByText('Перемещена в колонку «Ждёт ответа»')).toBeOnTheScreen();
  });
});

describe('a card given to her on a board she does not see', () => {
  beforeEach(() => {
    mockState.viewer = { id: READER, isAdmin: false };
    mockState.boards = [board(SECOND, 'Закупки', READER)];
    mockState.detail = cardDetailSchema.parse({
      ...DETAIL,
      assignee_id: READER,
      assignee: { full_name: 'Ира' },
    });
  });

  test('she moves it, changes its fields and steps, comments — and no more', async () => {
    await render(<CardScreen cardId={DETAIL.id} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Открыто' }));
    expect(mockSpies.move).toHaveBeenCalledWith({ cardId: DETAIL.id, column: COLUMNS[0] });
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Комментарий')).toBeOnTheScreen();
    expect(screen.getByLabelText('Добавить шаг')).toBeOnTheScreen();
    expect(screen.getByText('Ира')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Исполнитель:/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Дублировать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'В архив' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(screen.queryByText(/владел|админ|закрыт/i)).toBeNull();
  });

  test('archived, it is read without «Вернуть»', async () => {
    mockState.detail = cardDetailSchema.parse({
      ...mockState.detail,
      archived_at: '2026-11-20T10:00:00Z',
    });
    await render(<CardScreen cardId={DETAIL.id} />);
    expect(screen.getByText('Карточка в архиве')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Вернуть' })).toBeNull();
    expect(screen.queryByLabelText('Комментарий')).toBeNull();
  });
});

describe('«Назначено мне»', () => {
  const hidden = (): MyCard => {
    // Cached by the build before the columns: no `column_id`.
    const { column_id: _column, ...old } = card(1, { title: 'Ремонт ванной', assignee_id: OWNER });
    return myCardSchema.parse({ ...old, board: null });
  };
  const onSecond = (): MyCard =>
    myCardSchema.parse({
      ...card(2, {
        title: 'Купить лампы',
        board_id: SECOND,
        column_id: 'c01a2b3c-0000-4000-8000-000000000099',
        column_key: 'in_progress',
        assignee_id: OWNER,
      }),
      board: { id: SECOND, title: 'Закупки', owner_id: READER, archived_at: null },
    });

  test('by the four stages, a board she does not see named «Закрытая доска»; the card opens', async () => {
    mockState.mine = [hidden(), onSecond()];
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Назначено мне' }));
    expect(screen.getByRole('tab', { name: 'Открыто 1' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'В работе 1' })).toBeOnTheScreen();
    expect(screen.getByText('Закрытая доска')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText(/^Ремонт ванной\. Закрытая доска/));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/board-card/[id]',
      params: { id: mockState.mine[0].id },
    });
    await fireEvent.press(screen.getByRole('tab', { name: /^В работе/ }));
    expect(screen.getByText('Доска «Закупки»')).toBeOnTheScreen();
  });

  test('no board of her own to see, cards given to her: «Назначено мне», not «no boards»', async () => {
    mockState.boards = [];
    mockState.mine = [hidden()];
    await render(<BoardsTab />);
    expect(screen.getByText('Ремонт ванной')).toBeOnTheScreen();
    expect(screen.queryByText(/^Досок пока нет/)).toBeNull();
    expect(screen.getByRole('tab', { name: 'Назначено мне' })).toBeSelected();
  });
});
