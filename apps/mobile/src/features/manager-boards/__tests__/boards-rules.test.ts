import { t } from 'i18next';

import {
  deleteColumn,
  moveCard,
  orderColumns,
  saveBoard,
  saveCard,
  saveColumn,
  saveComment,
  saveStep,
  setCardShelf,
  setColumnDone,
  transferBoard,
} from '../api';
import { columnIdOf, columnLabel, columnLabelById } from '../columns';
import { entrySentence } from '../format';
import {
  boardCardSchema,
  boardColumnSchema,
  boardSchema,
  canDeleteComment,
  canEditBoard,
  canEditComment,
  cardAccess,
  cardEntrySchema,
  onLiveBoards,
  shelfOf,
  type BoardViewer,
  type ColumnRow,
} from '../schema';

/**
 * The phone's manager boards (20261118200000, 20261126120000): who changes
 * what — the same rule as the server's and the panel's — the journal's facts
 * said in words, the board's own columns, and what each write sends.
 */

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const OWNER: BoardViewer = { id: 'owner', isAdmin: false };
const READER: BoardViewer = { id: 'reader', isAdmin: false };
const ADMIN: BoardViewer = { id: 'admin', isAdmin: true };

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe('who changes what', () => {
  test('the owner and an admin change a live board; another manager reads it', () => {
    const board = { owner_id: 'owner', archived_at: null };
    expect(canEditBoard(board, OWNER)).toBe(true);
    expect(canEditBoard(board, ADMIN)).toBe(true);
    expect(canEditBoard(board, READER)).toBe(false);
    expect(canEditBoard({ ...board, archived_at: 'x' }, ADMIN)).toBe(false);
  });

  test("a comment is its author's to change; its author's or an admin's to delete", () => {
    const mine = { kind: 'comment' as const, author_id: 'owner' };
    expect(canEditComment(mine, OWNER)).toBe(true);
    expect(canEditComment(mine, ADMIN)).toBe(false);
    expect(canDeleteComment(mine, ADMIN)).toBe(true);
    expect(canDeleteComment({ kind: 'step_done', author_id: 'owner' }, OWNER)).toBe(false);
  });

  test('the shelves', () => {
    expect(shelfOf({ archived_at: null, deleted_at: null })).toBe('active');
    expect(shelfOf({ archived_at: 'x', deleted_at: null })).toBe('archived');
    expect(shelfOf({ archived_at: null, deleted_at: 'x' })).toBe('deleted');
  });
});

describe('the journal in words', () => {
  const line = (kind: string, facts: Record<string, unknown>) =>
    cardEntrySchema.parse({
      id: 'e',
      kind,
      body: null,
      facts,
      author_id: null,
      created_at: '2026-11-18T10:00:00Z',
      edited_at: null,
      author: null,
    });

  test('a move names the column', () => {
    expect(entrySentence(line('moved', { from: 'open', to: 'in_progress' }), t)).toBe(
      'Перемещена в колонку «В работе»',
    );
  });

  test('a move names the column by its id: renamed or deleted, by its name now', () => {
    const columns = [
      boardColumnSchema.parse({
        id: 'col-5',
        board_id: 'b1',
        title: 'Ждёт ответа',
        preset: null,
        position: 2,
        is_done: false,
        legacy_key: 'assigned',
        deleted_at: '2026-11-20T10:00:00Z',
      }),
    ];
    const nameOf = (id: string) => columnLabelById(columns, id, t);
    const moved = line('moved', {
      from: 'open',
      to: 'assigned',
      from_column: 'col-1',
      to_column: 'col-5',
    });
    expect(entrySentence(moved, t, undefined, nameOf)).toBe('Перемещена в колонку «Ждёт ответа»');
    // A column the phone has not read: the stage's word, as an older line.
    const unread = { ...moved, facts: { ...moved.facts, to_column: 'col-x' } };
    expect(entrySentence(unread, t, undefined, nameOf)).toBe('Перемещена в колонку «Назначено»');
  });

  test("a tick carries the count and no step's words", () => {
    expect(entrySentence(line('step_done', { done: 2, total: 5 }), t)).toBe('Шаг отмечен · 2/5');
  });

  test('a due date set, changed and removed', () => {
    expect(entrySentence(line('due_changed', { from: null, to: '2026-11-20' }), t)).toMatch(
      /^Срок назначен: /,
    );
    expect(entrySentence(line('due_changed', { from: '2026-11-20', to: null }), t)).toMatch(
      /^Срок снят \(был /,
    );
    expect(entrySentence(line('due_changed', { from: '2026-11-20', to: '2026-11-22' }), t)).toMatch(
      /^Срок изменён: .+ → .+$/,
    );
  });
});

describe('the writes', () => {
  test('a new card sends its column by id and its steps, and null for no date, place or colour', async () => {
    await saveCard({
      cardId: 'c1',
      boardId: 'b1',
      columnId: 'col-1',
      steps: ['one'],
      fields: { title: ' T ', description: '', dueOn: null, propertyId: null, color: null },
    });
    expect(mockRpc).toHaveBeenCalledWith('save_manager_card', {
      p_id: 'c1',
      p_board_id: 'b1',
      p_title: 'T',
      p_description: '',
      p_due_on: null,
      p_property_id: null,
      p_color: null,
      p_column_id: 'col-1',
      p_steps: ['one'],
    });
  });

  test("a change of a step's or a comment's words names no card", async () => {
    await saveStep({ stepId: 's1', cardId: null, body: ' new ' });
    await saveComment({ entryId: 'e1', cardId: null, body: 'changed' });
    expect(mockRpc.mock.calls).toEqual([
      ['save_manager_step', { p_id: 's1', p_card_id: null, p_body: 'new' }],
      ['save_manager_comment', { p_id: 'e1', p_card_id: null, p_body: 'changed' }],
    ]);
  });

  test('a saved card sends neither a column nor steps', async () => {
    await saveCard({
      cardId: 'c1',
      boardId: 'b1',
      fields: { title: 'T', description: 'd', dueOn: '2026-11-20', propertyId: 3, color: 'sky' },
    });
    const args = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('p_column');
    expect(args).not.toHaveProperty('p_column_id');
    expect(args).not.toHaveProperty('p_steps');
  });

  test('a move, a shelf and a comment call their functions; a refusal reaches the caller', async () => {
    await moveCard({ cardId: 'c1', columnId: 'col-4' });
    await setCardShelf({ cardId: 'c1', shelf: 'archived' });
    await saveComment({ entryId: 'e1', cardId: 'c1', body: ' hi ' });
    expect(mockRpc.mock.calls).toEqual([
      ['move_manager_card', { p_id: 'c1', p_column_id: 'col-4' }],
      ['set_manager_card_state', { p_id: 'c1', p_state: 'archived' }],
      ['save_manager_comment', { p_id: 'e1', p_card_id: 'c1', p_body: 'hi' }],
    ]);
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'x', hint: 'serverErrors.boardNotYours' },
    });
    await expect(moveCard({ cardId: 'c1', columnId: 'col-1' })).rejects.toMatchObject({
      hint: 'serverErrors.boardNotYours',
    });
  });

  test('a board says who sees it when told; a rename without a word about it leaves it', async () => {
    await saveBoard({ boardId: 'b1', title: ' New ', shared: false });
    await saveBoard({ boardId: 'b1', title: 'Renamed' });
    expect(mockRpc.mock.calls).toEqual([
      ['save_manager_board', { p_id: 'b1', p_title: 'New', p_shared: false }],
      ['save_manager_board', { p_id: 'b1', p_title: 'Renamed' }],
    ]);
  });

  test('a transfer names the board and its new owner', async () => {
    await transferBoard({ boardId: 'b1', ownerId: 'p2' });
    expect(mockRpc).toHaveBeenCalledWith('transfer_manager_board', { p_id: 'b1', p_to: 'p2' });
  });

  test('the columns: an add names the board, a rename none; the order, the switch, the delete', async () => {
    await saveColumn({ columnId: 'col-9', boardId: 'b1', title: ' Ждёт ' });
    await saveColumn({ columnId: 'col-9', boardId: null, title: 'Ждёт ответа' });
    await orderColumns({ boardId: 'b1', columnIds: ['col-2', 'col-1'] });
    await setColumnDone({ columnId: 'col-9', done: true });
    await deleteColumn({ columnId: 'col-9', moveTo: null });
    await deleteColumn({ columnId: 'col-8', moveTo: 'col-1' });
    expect(mockRpc.mock.calls).toEqual([
      ['save_manager_board_column', { p_id: 'col-9', p_board_id: 'b1', p_title: 'Ждёт' }],
      ['save_manager_board_column', { p_id: 'col-9', p_board_id: null, p_title: 'Ждёт ответа' }],
      ['order_manager_board_columns', { p_board_id: 'b1', p_ids: ['col-2', 'col-1'] }],
      ['set_manager_board_column_done', { p_id: 'col-9', p_done: true }],
      ['delete_manager_board_column', { p_id: 'col-9' }],
      ['delete_manager_board_column', { p_id: 'col-8', p_move_to: 'col-1' }],
    ]);
  });
});

const column = (n: number, overrides: Partial<ColumnRow> = {}): ColumnRow =>
  boardColumnSchema.parse({
    id: `col-${n}`,
    board_id: 'b1',
    title: null,
    preset: ['open', 'assigned', 'in_progress', 'resolved'][n - 1] ?? null,
    position: n,
    is_done: n === 4,
    legacy_key: ['open', 'assigned', 'in_progress', 'resolved'][n - 1] ?? 'in_progress',
    deleted_at: null,
    ...overrides,
  });

const PRESETS = [column(1), column(2), column(3), column(4)];

describe('the columns of a board (20261126120000)', () => {
  test('a preset column reads in the reader’s words; a renamed one by its own name', () => {
    expect(columnLabel(column(1), t)).toBe('Открыто');
    expect(columnLabel(column(1, { title: 'Входящие' }), t)).toBe('Входящие');
  });

  test('a card stands in its own column', () => {
    expect(columnIdOf({ column_id: 'col-3', column_key: 'in_progress' }, PRESETS)).toBe('col-3');
  });

  test('a card cached before the columns stands in the first column of its stage, else the nearest', () => {
    const custom = [
      column(1),
      column(5, { title: 'Ждёт', preset: null, position: 2, legacy_key: 'assigned' }),
      column(6, { title: 'Ещё', preset: null, position: 3, legacy_key: 'assigned' }),
      column(4, { position: 4 }),
    ];
    expect(columnIdOf({ column_id: null, column_key: 'assigned' }, custom)).toBe('col-5');
    expect(columnIdOf({ column_id: null, column_key: 'in_progress' }, custom)).toBe('col-5');
    expect(columnIdOf({ column_id: null, column_key: 'resolved' }, custom)).toBe('col-4');
  });

  test('a card whose column went meanwhile stands by its stage; an unknown stage nowhere', () => {
    expect(columnIdOf({ column_id: 'col-gone', column_key: 'open' }, PRESETS)).toBe('col-1');
    expect(columnIdOf({ column_id: null, column_key: 'waiting' }, PRESETS)).toBeNull();
    expect(columnIdOf({ column_id: null, column_key: 'open' }, [])).toBeNull();
  });

  test('a board cached before visibility reads as shared; a card before the columns with none', () => {
    const board = boardSchema.parse({
      id: 'b1',
      title: 'Проекты',
      owner_id: 'owner',
      archived_at: null,
      created_at: '2026-11-01T10:00:00Z',
      owner: null,
    });
    const card = boardCardSchema.parse({
      id: 'c1',
      board_id: 'b1',
      title: 'T',
      description: '',
      column_key: 'open',
      color: null,
      due_on: null,
      property_id: null,
      created_at: '2026-11-01T10:00:00Z',
      moved_at: '2026-11-01T10:00:00Z',
      archived_at: null,
      deleted_at: null,
      property: null,
      steps: [],
    });
    expect(board.shared).toBe(true);
    expect(card.column_id).toBeNull();
  });
});

describe('a card on a board the viewer does not see (20261126120000)', () => {
  const live = { archived_at: null };

  test('on a board she sees: all of it while the board is live', () => {
    expect(cardAccess({ assignee_id: null }, live, READER)).toEqual({
      canWork: true,
      canManage: true,
    });
    expect(cardAccess({ assignee_id: null }, { archived_at: 'x' }, ADMIN)).toEqual({
      canWork: false,
      canManage: false,
    });
  });

  test('given to her on a board she does not see: the card’s work, nothing of the board’s', () => {
    expect(cardAccess({ assignee_id: 'reader' }, null, READER)).toEqual({
      canWork: true,
      canManage: false,
    });
    expect(cardAccess({ assignee_id: 'owner' }, null, READER)).toEqual({
      canWork: false,
      canManage: false,
    });
  });

  test('«Назначено мне» keeps a hidden board’s card and drops an archived board’s', () => {
    const cards = [
      { id: 'hidden', board: null },
      { id: 'live', board: { id: 'b1', title: 'B', owner_id: 'o', archived_at: null } },
      { id: 'archived', board: { id: 'b2', title: 'A', owner_id: 'o', archived_at: 'x' } },
    ];
    expect(onLiveBoards(cards).map((card) => card.id)).toEqual(['hidden', 'live']);
  });
});
