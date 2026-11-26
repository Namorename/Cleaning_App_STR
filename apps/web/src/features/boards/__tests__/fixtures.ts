import { BOARD_COLUMNS, type BoardColumn } from '@str-ops/shared';
import { useState } from 'react';
import { vi } from 'vitest';

import {
  boardCardSchema,
  boardColumnRowSchema,
  boardSchema,
  cardDetailSchema,
  type Board,
  type BoardCard,
  type CardDetail,
  type ColumnRow,
  type MyCard,
  type OfficePerson,
} from '../schema';

/**
 * The boards' screens under test: their rows, the state the mocked hooks read, and the writes they
 * record. A test file mocks `../use-boards` with `useBoardsModule` (an async factory importing this
 * file) and calls `resetBoards()` before each test.
 */

export const TODAY = '2026-11-18';
export const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
export const OTHER_BOARD = 'b0a2d100-0000-4000-8000-000000000002';
export const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
export const READER = 'aaaaaaaa-0000-4000-8000-000000000002';
export const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000003';
export const GONE = 'aaaaaaaa-0000-4000-8000-000000000009';
export const cardId = (n: number) => `b0a2d200-0000-4000-8000-00000000000${n}`;

/** The four preset columns of BOARD, by the stage each was made for. */
export const COLUMN: Readonly<Record<BoardColumn, string>> = {
  open: 'c0a2d300-0000-4000-8000-000000000001',
  assigned: 'c0a2d300-0000-4000-8000-000000000002',
  in_progress: 'c0a2d300-0000-4000-8000-000000000003',
  resolved: 'c0a2d300-0000-4000-8000-000000000004',
};

export function makeColumn(overrides: Partial<ColumnRow> & Pick<ColumnRow, 'id'>): ColumnRow {
  return boardColumnRowSchema.parse({
    board_id: BOARD,
    title: null,
    preset: null,
    position: 1,
    is_done: false,
    legacy_key: 'open',
    deleted_at: null,
    ...overrides,
  });
}

/** A board's four columns as a new board gets them: the technicians' words, the last finishing. */
export function presetColumns(boardId = BOARD): ColumnRow[] {
  return BOARD_COLUMNS.map((key, index) =>
    makeColumn({
      id: boardId === BOARD ? COLUMN[key] : `${boardId.slice(0, -2)}c${index + 1}`,
      board_id: boardId,
      preset: key,
      position: index + 1,
      is_done: key === 'resolved',
      legacy_key: key,
    }),
  );
}

export function makeBoard(overrides: Partial<Board> = {}): Board {
  return boardSchema.parse({
    id: BOARD,
    title: 'Проекты',
    owner_id: OWNER,
    archived_at: null,
    created_at: '2026-11-01T10:00:00Z',
    shared: true,
    owner: { full_name: 'Ольга Владелец' },
    ...overrides,
  });
}

/** A card of BOARD, in the preset column of its stage unless a column is named. */
export function makeCard(n: number, overrides: Partial<BoardCard> = {}): BoardCard {
  const stage = overrides.column_key ?? 'open';
  return boardCardSchema.parse({
    id: cardId(n),
    board_id: BOARD,
    title: `Карточка ${n}`,
    description: '',
    column_id: COLUMN[stage],
    column_key: stage,
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
}

export const CARDS: BoardCard[] = [
  makeCard(1, {
    title: 'Ремонт ванной',
    color: 'blue',
    due_on: '2026-11-10',
    steps: [
      { id: 's1', body: 'Плитка', done_at: '2026-11-11T10:00:00Z' },
      { id: 's2', body: 'Краска', done_at: null },
      { id: 's3', body: 'Сантехник', done_at: null },
    ],
  }),
  makeCard(2, { title: 'Звонок юристу', column_key: 'in_progress', due_on: TODAY }),
  makeCard(3, { title: 'Закупка готова', column_key: 'resolved' }),
  makeCard(4, {
    title: 'Старый проект',
    column_key: 'resolved',
    archived_at: '2026-11-12T10:00:00Z',
  }),
  makeCard(5, { title: 'Ошибочная', deleted_at: '2026-11-13T10:00:00Z' }),
];

export const DETAIL: CardDetail = cardDetailSchema.parse({
  ...CARDS[0],
  description: 'План: https://example.com/plan',
  created_by: OWNER,
  creator: { full_name: 'Ольга Владелец' },
  steps: [
    { id: 's1', body: 'Плитка', sort_order: 1, done_at: '2026-11-11T10:00:00Z' },
    { id: 's2', body: 'Краска', sort_order: 2, done_at: '2026-11-12T10:00:00Z' },
    { id: 's3', body: 'Сантехник', sort_order: 3, done_at: '2026-11-13T10:00:00Z' },
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
      author: { full_name: 'Ольга Владелец' },
    },
    {
      id: 'e2',
      kind: 'comment',
      body: 'Сантехник придёт во вторник',
      facts: {},
      author_id: OWNER,
      created_at: '2026-11-12T09:00:00Z',
      edited_at: '2026-11-12T10:00:00Z',
      author: { full_name: 'Ольга Владелец' },
    },
    {
      id: 'e3',
      kind: 'comment',
      body: 'Заметка админа',
      facts: {},
      author_id: ADMIN,
      created_at: '2026-11-13T09:00:00Z',
      edited_at: null,
      author: { full_name: 'Анна Админ' },
    },
  ],
});

export const PEOPLE: OfficePerson[] = [
  { id: ADMIN, full_name: 'Анна Админ', role: 'admin', is_active: true },
  { id: GONE, full_name: 'Вера Ушла', role: 'manager', is_active: false },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000008',
    full_name: 'Галя Горничная',
    role: 'cleaner',
    is_active: true,
  },
  { id: READER, full_name: 'Ира Читатель', role: 'manager', is_active: true },
  { id: OWNER, full_name: 'Ольга Владелец', role: 'manager', is_active: true },
];

/** The refusal of a write the server turns down, unless the test names its own. */
export const REFUSAL = { message: 'refused', hint: 'serverErrors.boardNotYours' };

export const state = {
  boards: [] as Board[],
  cards: [] as BoardCard[],
  columns: [] as ColumnRow[],
  detail: null as CardDetail | null,
  /** The last read of the cards failed, the rows read before it still in hand. */
  isStale: false,
  /** The writes the server refuses (by their spy), with REFUSAL. */
  failing: new Set<unknown>(),
  /** The writes the server refuses with an error of the test's own. */
  refusals: new Map<unknown, unknown>(),
  people: [] as OfficePerson[],
  /** The company's people could not be read. */
  peopleError: false,
  mine: [] as MyCard[],
  /** The columns of «Назначено мне»'s boards are not read yet. */
  columnsUnread: false,
  /** The writes the server has not answered yet (by their spy), until `releaseHeld()`. */
  held: new Set<unknown>(),
};

/** The answers of the held writes, in the order they were asked. */
let heldAnswers: (() => void)[] = [];

/** The server answers every held write now (call it inside `act`). */
export function releaseHeld() {
  const answers = heldAnswers;
  heldAnswers = [];
  for (const answer of answers) {
    answer();
  }
}

/** Every write the screens ask for. */
export const spies = {
  saveCard: vi.fn(),
  move: vi.fn(),
  shelve: vi.fn(),
  duplicate: vi.fn(),
  archiveBoard: vi.fn(),
  saveBoard: vi.fn(),
  transfer: vi.fn(),
  saveColumn: vi.fn(),
  orderColumns: vi.fn(),
  setColumnDone: vi.fn(),
  deleteColumn: vi.fn(),
  saveStep: vi.fn(),
  tick: vi.fn(),
  deleteStep: vi.fn(),
  orderSteps: vi.fn(),
  saveComment: vi.fn(),
  deleteComment: vi.fn(),
  assign: vi.fn(),
  /** A board dropped from the cache (useForgetBoard). */
  forget: vi.fn(),
};

/** The navigation the screens ask for. */
export const router = { push: vi.fn() };

interface MutateOptions {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
}

/**
 * A write as a server answers it at once: agreed, unless the test made it refuse — then the hook
 * holds the error, as useMutation does, and the screen reads it on its next render.
 */
function useMutationOf(spy: (variables: unknown) => void) {
  const [error, setError] = useState<unknown>(null);
  return {
    isPending: false,
    isError: error !== null,
    error,
    reset: () => setError(null),
    mutate: (variables: unknown, options?: MutateOptions) => {
      spy(variables);
      const answer = () => {
        const refusal = state.refusals.get(spy) ?? (state.failing.has(spy) ? REFUSAL : undefined);
        if (refusal === undefined) {
          setError(null);
          options?.onSuccess?.();
        } else {
          setError(refusal);
          options?.onError?.(refusal);
        }
        options?.onSettled?.();
      };
      if (state.held.has(spy)) {
        heldAnswers = [...heldAnswers, answer];
        return;
      }
      answer();
    },
  };
}

function read<T>(data: T) {
  return { isPending: false, isError: false, isFetching: false, error: null, data };
}

/** The module `../use-boards` stands for in the screens' tests. */
export const useBoardsModule = {
  useBoards: () => read(state.boards),
  useBoardCards: () => ({
    ...read(state.cards),
    isError: state.isStale,
    error: state.isStale ? new Error('offline') : null,
  }),
  useBoardColumns: (boardId: string | null) =>
    read(
      boardId === null ? undefined : state.columns.filter((column) => column.board_id === boardId),
    ),
  useCard: () => ({
    ...read(state.detail),
    isError: state.isStale,
    error: state.isStale ? new Error('offline') : null,
  }),
  useBoardColumnsOf: (boardIds: readonly string[]) =>
    read(
      state.columnsUnread
        ? undefined
        : state.columns.filter((column) => boardIds.includes(column.board_id)),
    ),
  useMyCards: () => read(state.mine),
  useOfficePeople: () =>
    state.peopleError
      ? { ...read(undefined), isError: true, error: { message: 'people offline' } }
      : read(state.people),
  useForgetBoard: () => spies.forget,
  useSaveCard: () => useMutationOf(spies.saveCard),
  useMoveCard: () => useMutationOf(spies.move),
  useSetCardShelf: () => useMutationOf(spies.shelve),
  useDuplicateCard: () => useMutationOf(spies.duplicate),
  useSetBoardArchived: () => useMutationOf(spies.archiveBoard),
  useSaveBoard: () => useMutationOf(spies.saveBoard),
  useTransferBoard: () => useMutationOf(spies.transfer),
  useSaveColumn: () => useMutationOf(spies.saveColumn),
  useOrderColumns: () => useMutationOf(spies.orderColumns),
  useSetColumnDone: () => useMutationOf(spies.setColumnDone),
  useDeleteColumn: () => useMutationOf(spies.deleteColumn),
  useSaveStep: () => useMutationOf(spies.saveStep),
  useSetStepDone: () => useMutationOf(spies.tick),
  useDeleteStep: () => useMutationOf(spies.deleteStep),
  useOrderSteps: () => useMutationOf(spies.orderSteps),
  useSaveComment: () => useMutationOf(spies.saveComment),
  useDeleteComment: () => useMutationOf(spies.deleteComment),
  useSetCardAssignee: () => useMutationOf(spies.assign),
};

/** Every test starts from one shared board of four columns, its cards and the company's people. */
export function resetBoards() {
  state.boards = [makeBoard()];
  state.cards = CARDS;
  state.columns = presetColumns();
  state.detail = DETAIL;
  state.isStale = false;
  state.failing = new Set();
  state.refusals = new Map();
  state.people = PEOPLE;
  state.peopleError = false;
  state.mine = [];
  state.columnsUnread = false;
  state.held = new Set();
  heldAnswers = [];
  vi.clearAllMocks();
}
