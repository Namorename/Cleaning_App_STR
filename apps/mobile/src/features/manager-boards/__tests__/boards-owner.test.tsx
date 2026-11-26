import { fireEvent, render, screen } from '@testing-library/react-native';

import { BoardNameSheet, boardSaveOf } from '../board-sheets';
import { BoardsTab } from '../boards-tab';
import { ColumnsSheet } from '../columns-sheet';
import {
  boardCardSchema,
  boardColumnSchema,
  boardSchema,
  type Board,
  type BoardCard,
  type BoardViewer,
  type ColumnRow,
  type OfficePerson,
} from '../schema';
import { TransferSheet } from '../transfer-sheet';

/**
 * What a board's owner and an admin do with the board itself (20261126120000): who sees it — on
 * the new board's form and in «Настройки доски» — its columns, and handing it to another manager.
 * Another manager reaches none of it: the menu is not there (boards-screens.test.tsx).
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-crypto', () => {
  let minted = 0;
  return {
    randomUUID: () => {
      minted += 1;
      return `f1a2b3c4-3333-4333-8333-${String(minted).padStart(12, '0')}`;
    },
  };
});
jest.mock('@/features/board/use-board', () => ({
  useStaffDirectory: () => ({ data: mockState.staff, isPending: false, isError: false }),
}));

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const READER = 'aaaaaaaa-0000-4000-8000-000000000002';
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000003';
const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
const SECOND = 'b0a2d100-0000-4000-8000-000000000002';
const OPEN = 'c01a2b3c-0000-4000-8000-000000000001';
const WAITING = 'c01a2b3c-0000-4000-8000-000000000005';
const DONE = 'c01a2b3c-0000-4000-8000-000000000006';

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

const board = (id: string, title: string, owner = OWNER, shared = false): Board =>
  boardSchema.parse({
    id,
    title,
    owner_id: owner,
    archived_at: null,
    created_at: '2026-11-01T10:00:00Z',
    shared,
    owner: { full_name: owner === OWNER ? 'Ольга' : 'Ира' },
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

const COLUMNS: ColumnRow[] = [
  column({ id: OPEN, preset: 'open', position: 1 }),
  column({ id: WAITING, title: 'Ждёт ответа', position: 2, legacy_key: 'in_progress' }),
  column({ id: DONE, title: 'Сделано', position: 3, is_done: true, legacy_key: 'resolved' }),
  column({
    id: 'c01a2b3c-0000-4000-8000-000000000007',
    title: 'Старая',
    position: 2,
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

/** «Открыто» holds two — one of them in the archive; «Сделано» none. */
const CARDS = [
  card(1, { title: 'Ремонт ванной' }),
  card(2, { title: 'Старое', archived_at: '2026-11-10T10:00:00Z' }),
  card(3, { title: 'Звонок юристу', column_id: WAITING, column_key: 'in_progress' }),
];

const mockState: {
  viewer: BoardViewer;
  boards: Board[];
  cards: BoardCard[];
  columns: ColumnRow[];
  staff: OfficePerson[];
  /** The writes the server refuses, with what it says. */
  refused: Map<jest.Mock, unknown>;
} = {
  viewer: { id: OWNER, isAdmin: false },
  boards: [],
  cards: [],
  columns: [],
  staff: [],
  refused: new Map(),
};

const mockSpies = {
  saveBoard: jest.fn(),
  transfer: jest.fn(),
  saveColumn: jest.fn(),
  orderColumns: jest.fn(),
  setColumnDone: jest.fn(),
  deleteColumn: jest.fn(),
};

function mockMutation(spy?: jest.Mock) {
  const refusal = spy === undefined ? undefined : mockState.refused.get(spy);
  return {
    isPending: false,
    isError: refusal !== undefined,
    error: refusal ?? null,
    reset: jest.fn(),
    mutate: (
      variables: unknown,
      options?: { onSuccess?: () => void; onError?: (error: unknown) => void },
    ) => {
      spy?.(variables);
      if (refusal === undefined) {
        options?.onSuccess?.();
      } else {
        options?.onError?.(refusal);
      }
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
  useBoardColumns: () => mockRead(mockState.columns),
  useMyCards: () => mockRead([]),
  useSaveBoard: () => mockMutation(mockSpies.saveBoard),
  useTransferBoard: () => mockMutation(mockSpies.transfer),
  useSaveColumn: () => mockMutation(mockSpies.saveColumn),
  useOrderColumns: () => mockMutation(mockSpies.orderColumns),
  useSetColumnDone: () => mockMutation(mockSpies.setColumnDone),
  useDeleteColumn: () => mockMutation(mockSpies.deleteColumn),
  useSaveCard: () => mockMutation(),
  useSetCardShelf: () => mockMutation(),
  useSetBoardArchived: () => mockMutation(),
}));

beforeEach(() => {
  mockState.viewer = { id: OWNER, isAdmin: false };
  mockState.boards = [board(BOARD, 'Проекты'), board(SECOND, 'Закупки', READER, true)];
  mockState.cards = CARDS;
  mockState.columns = COLUMNS;
  mockState.staff = STAFF;
  mockState.refused = new Map();
  jest.clearAllMocks();
});

async function openMenuItem(name: string): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Действия с доской' }));
  await fireEvent.press(screen.getByRole('button', { name }));
}

describe('who sees a board', () => {
  test('a new board is hers alone unless she says otherwise', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByLabelText('Новая доска'));
    expect(screen.getByRole('radio', { name: 'Видна только мне' })).toBeChecked();
    expect(screen.getByText(/^Админ видит все доски/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Название доски'), 'Ремонт');
    await fireEvent.press(screen.getByRole('button', { name: 'Создать' }));
    expect(mockSpies.saveBoard).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Ремонт', shared: false }),
    );
  });

  test('shared with the office when she chooses so', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByLabelText('Новая доска'));
    await fireEvent.changeText(screen.getByLabelText('Название доски'), 'Закупки на зиму');
    await fireEvent.press(screen.getByRole('radio', { name: 'Видна другим менеджерам' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Создать' }));
    expect(mockSpies.saveBoard).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Закупки на зиму', shared: true }),
    );
  });

  test('«Настройки доски»: an admin on another’s board reads «Видна только владельцу»', async () => {
    mockState.viewer = { id: ADMIN, isAdmin: true };
    mockState.boards = [board(BOARD, 'Проекты', OWNER, true)];
    await render(<BoardsTab />);
    await openMenuItem('Настройки доски');
    expect(screen.getByRole('radio', { name: 'Видна другим менеджерам' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Видна только мне' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Видна только владельцу' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveBoard).toHaveBeenCalledWith({
      boardId: BOARD,
      title: 'Проекты',
      shared: false,
    });
  });
});

describe('«Настройки доски» send only what she changed (review H1)', () => {
  const settings = (shared: boolean, isVisible: boolean, title = 'Проекты') => (
    <BoardNameSheet
      isVisible={isVisible}
      board={{ id: BOARD, title, shared, owner_id: OWNER }}
      viewer={{ id: OWNER, isAdmin: false }}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />
  );

  test('a board made private meanwhile: opened, renamed, saved — who sees it is not sent', async () => {
    const view = await render(settings(true, false));
    await view.rerender(settings(false, false));
    await view.rerender(settings(false, true));
    expect(screen.getByRole('radio', { name: 'Видна только мне' })).toBeChecked();
    await fireEvent.changeText(screen.getByLabelText('Название доски'), 'Проекты 2027');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveBoard).toHaveBeenCalledWith({ boardId: BOARD, title: 'Проекты 2027' });
  });

  test('a sheet opened before shows, and saves, the board as it is now', async () => {
    mockState.boards = [board(BOARD, 'Проекты', OWNER, true), board(SECOND, 'Закупки', READER)];
    const view = await render(<BoardsTab />);
    await openMenuItem('Настройки доски');
    expect(screen.getByRole('radio', { name: 'Видна другим менеджерам' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Видна только мне' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
    // Meanwhile, elsewhere: the board renamed and made its owner's alone.
    mockState.boards = [board(BOARD, 'Склад', OWNER, false), board(SECOND, 'Закупки', READER)];
    await view.rerender(<BoardsTab />);
    await openMenuItem('Настройки доски');
    expect(screen.getByLabelText('Название доски').props.value).toBe('Склад');
    expect(screen.getByRole('radio', { name: 'Видна только мне' })).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveBoard).toHaveBeenCalledWith({ boardId: BOARD, title: 'Склад' });
  });

  test('the visibility she picks is sent; picked back to what it is, it is not', async () => {
    const view = await render(settings(false, true));
    await fireEvent.press(screen.getByRole('radio', { name: 'Видна другим менеджерам' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveBoard).toHaveBeenLastCalledWith({
      boardId: BOARD,
      title: 'Проекты',
      shared: true,
    });
    await view.rerender(settings(false, false));
    await view.rerender(settings(false, true));
    await fireEvent.press(screen.getByRole('radio', { name: 'Видна другим менеджерам' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Видна только мне' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveBoard).toHaveBeenLastCalledWith({ boardId: BOARD, title: 'Проекты' });
  });

  test('what a save carries', () => {
    const untouched = { title: null, visibility: null };
    const current = { title: 'Проекты', shared: true };
    expect(boardSaveOf(BOARD, current, untouched)).toEqual({ boardId: BOARD, title: 'Проекты' });
    expect(boardSaveOf(BOARD, current, { title: 'Новое', visibility: 'shared' })).toEqual({
      boardId: BOARD,
      title: 'Новое',
    });
    expect(boardSaveOf(BOARD, current, { title: null, visibility: 'private' })).toEqual({
      boardId: BOARD,
      title: 'Проекты',
      shared: false,
    });
    // A new board always says who sees it: its maker alone unless she chose otherwise.
    expect(boardSaveOf(BOARD, undefined, { title: 'Ремонт', visibility: null })).toEqual({
      boardId: BOARD,
      title: 'Ремонт',
      shared: false,
    });
  });
});

describe('the board menu', () => {
  test('its owner: the settings, the columns, the transfer and the archive', async () => {
    await render(<BoardsTab />);
    await fireEvent.press(screen.getByRole('button', { name: 'Действия с доской' }));
    for (const name of ['Настройки доски', 'Колонки', 'Передать доску', 'Убрать доску в архив']) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }
  });

  test('another manager on a shared board: no menu at all', async () => {
    mockState.viewer = { id: READER, isAdmin: false };
    mockState.boards = [board(BOARD, 'Проекты', OWNER, true)];
    await render(<BoardsTab />);
    expect(screen.queryByRole('button', { name: 'Действия с доской' })).toBeNull();
  });
});

describe('the columns sheet', () => {
  const sheet = (columns: readonly ColumnRow[] = COLUMNS, cards: readonly BoardCard[] = CARDS) => (
    <ColumnsSheet
      isVisible
      board={{ id: BOARD, title: 'Проекты' }}
      columns={columns}
      cards={cards}
      onClose={jest.fn()}
    />
  );

  test('the live columns in order; a tap opens what is done with one', async () => {
    await render(sheet());
    // A column's head is the one button that opens and closes.
    const heads = screen
      .getAllByRole('button')
      .filter((one) => one.props.accessibilityState?.expanded !== undefined)
      .map((head) => head.props.accessibilityLabel);
    expect(heads).toEqual(['Открыто', 'Ждёт ответа', 'Сделано. Завершающая']);
    await fireEvent.press(screen.getByRole('button', { name: 'Открыто' }));
    expect(screen.getByRole('button', { name: 'Выше' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ниже' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Завершающая' })).not.toBeChecked();
  });

  test('«Ниже» and «Выше» send every live column once, in the new order', async () => {
    await render(sheet());
    await fireEvent.press(screen.getByRole('button', { name: 'Открыто' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ниже' }));
    expect(mockSpies.orderColumns).toHaveBeenCalledWith({
      boardId: BOARD,
      columnIds: [WAITING, OPEN, DONE],
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Открыто' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Сделано. Завершающая' }));
    expect(screen.getByRole('button', { name: 'Ниже' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Выше' }));
    expect(mockSpies.orderColumns).toHaveBeenLastCalledWith({
      boardId: BOARD,
      columnIds: [OPEN, DONE, WAITING],
    });
  });

  test('«Завершающая» is set as wanted, never flipped blind', async () => {
    await render(sheet());
    await fireEvent.press(screen.getByRole('button', { name: 'Сделано. Завершающая' }));
    expect(screen.getByRole('switch', { name: 'Завершающая' })).toBeChecked();
    await fireEvent.press(screen.getByRole('switch', { name: 'Завершающая' }));
    expect(mockSpies.setColumnDone).toHaveBeenCalledWith({ columnId: DONE, done: false });
  });

  test('a rename sends the new name; a preset saved unchanged keeps its word for everybody', async () => {
    await render(sheet());
    await fireEvent.press(screen.getByRole('button', { name: 'Открыто' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Переименовать колонку' }));
    expect(screen.getByLabelText('Переименовать колонку').props.value).toBe('Открыто');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveColumn).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Переименовать колонку' }));
    await fireEvent.changeText(screen.getByLabelText('Переименовать колонку'), ' Входящие ');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mockSpies.saveColumn).toHaveBeenCalledWith({
      columnId: OPEN,
      boardId: null,
      title: 'Входящие',
    });
  });

  test('a new column at the end; a repeat after a refusal is the same column', async () => {
    mockState.refused.set(mockSpies.saveColumn, { message: 'lost' });
    await render(sheet());
    const field = screen.getByLabelText('Название колонки');
    await fireEvent.changeText(field, 'Ждёт запчастей');
    await fireEvent.press(screen.getByRole('button', { name: 'Добавить колонку' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Добавить колонку' }));
    const [first, second] = mockSpies.saveColumn.mock.calls.map(([variables]) => variables);
    expect(first).toEqual({
      columnId: expect.any(String),
      boardId: BOARD,
      title: 'Ждёт запчастей',
    });
    expect(second).toEqual(first);
  });

  test('twelve live columns: no more is offered', async () => {
    const twelve = Array.from({ length: 12 }, (_, index) =>
      column({
        id: `c01a2b3c-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
        position: index + 1,
        title: `К${index + 1}`,
      }),
    );
    await render(sheet(twelve, []));
    expect(screen.queryByLabelText('Название колонки')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить колонку' })).toBeNull();
    expect(screen.getByText('Колонок не больше 12.')).toBeOnTheScreen();
  });

  test('an empty column is deleted after one question, naming no other', async () => {
    await render(sheet());
    await fireEvent.press(screen.getByRole('button', { name: 'Сделано. Завершающая' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить колонку' }));
    expect(screen.getByText('Удалить колонку «Сделано»?')).toBeOnTheScreen();
    expect(screen.getByText('В колонке нет карточек.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить колонку' }));
    expect(mockSpies.deleteColumn).toHaveBeenCalledWith({ columnId: DONE, moveTo: null });
  });

  test('a column holding cards — the archived ones too — is deleted only with where they go', async () => {
    await render(sheet());
    await fireEvent.press(screen.getByRole('button', { name: 'Открыто' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить колонку' }));
    expect(
      screen.getByText(/^Карточек в колонке \(вместе с архивными и удалёнными\): 2\./),
    ).toBeOnTheScreen();
    const confirm = screen.getByRole('button', { name: 'Удалить колонку' });
    expect(confirm).toBeDisabled();
    expect(screen.queryByRole('radio', { name: 'Открыто' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Сделано' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить колонку' }));
    expect(mockSpies.deleteColumn).toHaveBeenCalledWith({ columnId: OPEN, moveTo: DONE });
  });

  test('cards the phone had not read: the server’s refusal asks where they go, and keeps asking', async () => {
    mockState.refused.set(mockSpies.deleteColumn, {
      message: 'Column holds cards',
      hint: 'serverErrors.boardColumnHasCards',
      details: JSON.stringify({ count: 3 }),
    });
    await render(sheet(COLUMNS, []));
    await fireEvent.press(screen.getByRole('button', { name: 'Ждёт ответа' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить колонку' }));
    expect(screen.getByText('В колонке нет карточек.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить колонку' }));
    expect(mockSpies.deleteColumn).toHaveBeenLastCalledWith({ columnId: WAITING, moveTo: null });
    expect(
      screen.getByText('В колонке есть карточки (3): выберите, куда их перенести'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(/^Карточек в колонке \(вместе с архивными и удалёнными\): 3\./),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Удалить колонку' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Открыто' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить колонку' }));
    expect(mockSpies.deleteColumn).toHaveBeenLastCalledWith({ columnId: WAITING, moveTo: OPEN });
    // Refused again: the choice stays asked for, the column chosen kept.
    expect(screen.getByRole('radio', { name: 'Открыто' })).toBeChecked();
  });

  test('the last column stays: no delete, and a word why', async () => {
    await render(sheet([COLUMNS[0]], []));
    await fireEvent.press(screen.getByRole('button', { name: 'Открыто' }));
    expect(screen.queryByRole('button', { name: 'Удалить колонку' })).toBeNull();
    expect(screen.getByText('Последнюю колонку удалить нельзя.')).toBeOnTheScreen();
  });

  test('reached from the board menu, with the board’s name', async () => {
    await render(<BoardsTab />);
    await openMenuItem('Колонки');
    expect(screen.getByText('Колонки доски «Проекты»')).toBeOnTheScreen();
  });
});

describe('handing a board over', () => {
  const sheet = (viewer: BoardViewer, shared: boolean, onTransferred = jest.fn()) => (
    <TransferSheet
      isVisible
      board={{ id: BOARD, title: 'Проекты', owner_id: OWNER, shared }}
      viewer={viewer}
      onClose={jest.fn()}
      onTransferred={onTransferred}
    />
  );

  test('to an active manager or admin of the company but its owner', async () => {
    await render(sheet({ id: OWNER, isAdmin: false }, false));
    const people = screen.getAllByRole('radio').map((radio) => radio.props.accessibilityLabel);
    expect(people).toEqual(['Анна', 'Ира']);
    expect(screen.getByText('Выберите менеджера')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Передать' })).toBeDisabled();
  });

  test.each([
    [{ id: OWNER, isAdmin: false }, false, /^Доска видна только владельцу: после передачи/],
    [{ id: OWNER, isAdmin: false }, true, /^Доска видна другим менеджерам: вы будете видеть/],
    [{ id: ADMIN, isAdmin: true }, false, /^Вы админ: доска останется вам видна/],
  ])('what %o keeps of a board shared=%s is said first', async (viewer, shared, note) => {
    await render(sheet(viewer, shared));
    expect(screen.getByText(note)).toBeOnTheScreen();
    expect(
      screen.getByText(/^Карточки, исполнители и доступ к доске не меняются/),
    ).toBeOnTheScreen();
  });

  test('the transfer names the board and the new owner, and says so after', async () => {
    const onTransferred = jest.fn();
    await render(sheet({ id: OWNER, isAdmin: false }, false, onTransferred));
    await fireEvent.press(screen.getByRole('radio', { name: 'Ира' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Передать' }));
    expect(mockSpies.transfer).toHaveBeenCalledWith({ boardId: BOARD, ownerId: READER });
    expect(onTransferred).toHaveBeenCalledWith('Ира');
  });

  test('nobody to hand it to: a word, and no button', async () => {
    mockState.staff = [STAFF[0]];
    await render(sheet({ id: OWNER, isAdmin: false }, false));
    expect(screen.getByText(/^Передать некому/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Передать' })).toBeNull();
  });

  test('a board she alone saw leaves her screen for the next one, and the handing-over is said', async () => {
    await render(<BoardsTab />);
    await openMenuItem('Передать доску');
    await fireEvent.press(screen.getByRole('radio', { name: 'Ира' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Передать' }));
    expect(screen.getByText('Доска передана: Ира')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Закупки' })).toBeSelected();
  });

  test('a shared board stays on her screen after it', async () => {
    mockState.boards = [
      board(BOARD, 'Проекты', OWNER, true),
      board(SECOND, 'Закупки', READER, true),
    ];
    await render(<BoardsTab />);
    await openMenuItem('Передать доску');
    await fireEvent.press(screen.getByRole('radio', { name: 'Ира' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Передать' }));
    expect(screen.getByText('Доска передана: Ира')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Проекты' })).toBeSelected();
  });
});

describe('a board asked for from a push', () => {
  test('is shown, and the ask is let go of; asked again later, shown again', async () => {
    const seen = jest.fn();
    const view = await render(<BoardsTab requestedBoardId={SECOND} onRequestSeen={seen} />);
    expect(screen.getByRole('tab', { name: 'Закупки' })).toBeSelected();
    expect(seen).toHaveBeenCalled();

    await view.rerender(<BoardsTab onRequestSeen={seen} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Проекты' }));
    expect(screen.getByRole('tab', { name: 'Проекты' })).toBeSelected();

    await view.rerender(<BoardsTab requestedBoardId={SECOND} onRequestSeen={seen} />);
    expect(screen.getByRole('tab', { name: 'Закупки' })).toBeSelected();
  });
});
