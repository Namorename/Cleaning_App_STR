import { describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';

import { boardHref, MY_CARDS, readBoardAddress, writeBoardAddress } from '../address';
import {
  deleteColumn,
  deleteComment,
  fetchBoardCards,
  fetchBoardColumns,
  fetchBoards,
  fetchCard,
  fetchMyCards,
  moveCard,
  orderColumns,
  orderSteps,
  saveBoard,
  saveCard,
  saveColumn,
  saveComment,
  saveStep,
  setCardShelf,
  setColumnDone,
  transferBoard,
  type Client,
} from '../api';
import { entrySentence } from '../card-journal';
import { columnLanes, laneOfCard, stageLanes } from '../lanes';
import { stepsFromLines } from '../new-card-dialog';
import {
  canDeleteComment,
  canEditBoard,
  canEditComment,
  cardEntrySchema,
  onLiveBoards,
  shelfOf,
  type BoardViewer,
} from '../schema';

import { makeColumn } from './fixtures';

const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
const CARD = 'b0a2d200-0000-4000-8000-000000000001';
const COLUMN = 'c0a2d300-0000-4000-8000-000000000001';
const TARGET = 'c0a2d300-0000-4000-8000-000000000002';
const OWNER: BoardViewer = { id: 'owner', isAdmin: false };
const READER: BoardViewer = { id: 'reader', isAdmin: false };
const ADMIN: BoardViewer = { id: 'admin', isAdmin: true };

describe('the address of a board', () => {
  test("a bare /problems is the technicians' board", () => {
    expect(readBoardAddress(new URLSearchParams(''))).toEqual({
      boardId: null,
      view: 'board',
      cardId: null,
    });
    expect(boardHref(null)).toBe('/problems');
  });

  test('a board, its archive and a card open over it go there and back', () => {
    const address = { boardId: BOARD, view: 'archive' as const, cardId: CARD };
    expect(readBoardAddress(new URLSearchParams(writeBoardAddress(address)))).toEqual(address);
    expect(boardHref(BOARD)).toBe(`/problems?board=${BOARD}`);
  });

  test('anything that is not an id is no board and no card', () => {
    expect(readBoardAddress(new URLSearchParams('board=x&card=y')).boardId).toBeNull();
    expect(readBoardAddress(new URLSearchParams(`board=${BOARD}&card=y`)).cardId).toBeNull();
    // The technicians' board's own views keep their parameter.
    expect(readBoardAddress(new URLSearchParams('view=archive')).view).toBe('board');
  });
});

describe('who changes what', () => {
  const board = { owner_id: 'owner', archived_at: null };

  test('the owner and an admin change a board; another manager reads it', () => {
    expect(canEditBoard(board, OWNER)).toBe(true);
    expect(canEditBoard(board, ADMIN)).toBe(true);
    expect(canEditBoard(board, READER)).toBe(false);
  });

  test('nobody changes an archived board', () => {
    expect(canEditBoard({ ...board, archived_at: '2026-11-18T10:00:00Z' }, OWNER)).toBe(false);
    expect(canEditBoard({ ...board, archived_at: '2026-11-18T10:00:00Z' }, ADMIN)).toBe(false);
  });

  test("its author changes a comment; its author or an admin deletes it; a system line is nobody's", () => {
    const mine = { kind: 'comment' as const, author_id: 'owner' };
    expect(canEditComment(mine, OWNER)).toBe(true);
    expect(canEditComment(mine, ADMIN)).toBe(false);
    expect(canDeleteComment(mine, ADMIN)).toBe(true);
    expect(canDeleteComment(mine, READER)).toBe(false);
    const line = { kind: 'moved' as const, author_id: 'owner' };
    expect(canEditComment(line, OWNER)).toBe(false);
    expect(canDeleteComment(line, ADMIN)).toBe(false);
  });

  test('a card is on the board, in the archive or among the deleted', () => {
    expect(shelfOf({ archived_at: null, deleted_at: null })).toBe('active');
    expect(shelfOf({ archived_at: 'x', deleted_at: null })).toBe('archived');
    expect(shelfOf({ archived_at: null, deleted_at: 'x' })).toBe('deleted');
  });
});

test('the steps of a new card are its lines, the empty ones dropped', () => {
  expect(stepsFromLines(' Call \n\n  Buy tiles\n')).toEqual(['Call', 'Buy tiles']);
  expect(stepsFromLines(Array.from({ length: 120 }, (_, n) => `s${n}`).join('\n'))).toHaveLength(
    100,
  );
});

describe("the journal says the server's facts in words", () => {
  const t = i18n.t.bind(i18n);
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

  test.each([
    ['moved', { from: 'open', to: 'resolved' }, 'Перемещена в колонку «Выполнено»'],
    ['step_done', { done: 3, total: 7 }, 'Шаг отмечен · 3/7'],
    ['due_changed', { from: null, to: '2026-11-20' }, 'Срок назначен: 20 нояб. 2026 г.'],
    ['due_changed', { from: '2026-11-20', to: null }, 'Срок снят (был 20 нояб. 2026 г.)'],
    [
      'due_changed',
      { from: '2026-11-20', to: '2026-11-25' },
      'Срок изменён: 20 нояб. 2026 г. → 25 нояб. 2026 г.',
    ],
  ])('%s %o', (kind, facts, sentence) => {
    expect(entrySentence(line(kind, facts), t, 'ru')).toBe(sentence);
  });

  test('a column the build does not know is a dash, not a crash', () => {
    expect(entrySentence(line('moved', { to: 'cancelled' }), t, 'ru')).toBe(
      'Перемещена в колонку «—»',
    );
  });

  // 20261126120000: the line names the column by id, as it is called now.
  test('a «moved» line names its column by id, else by the stage it keeps', () => {
    const facts = { from: 'open', to: 'in_progress', from_column: COLUMN, to_column: TARGET };
    const column = (id: string) => (id === TARGET ? 'Ждём ответа' : null);
    expect(entrySentence(line('moved', facts), t, 'ru', { column })).toBe(
      'Перемещена в колонку «Ждём ответа»',
    );
    expect(entrySentence(line('moved', { ...facts, to_column: COLUMN }), t, 'ru', { column })).toBe(
      'Перемещена в колонку «В работе»',
    );
    expect(entrySentence(line('moved', facts), t, 'ru')).toBe('Перемещена в колонку «В работе»');
  });
});

describe('the lanes of a board (20261126120000)', () => {
  const presetName = (key: string) => `[${key}]`;
  const columns = [
    makeColumn({ id: 'c2', title: 'Ждём', position: 2, legacy_key: 'in_progress' }),
    makeColumn({ id: 'c1', preset: 'open', position: 1, legacy_key: 'open' }),
    makeColumn({ id: 'c3', title: 'Старая', position: 3, deleted_at: '2026-11-20T10:00:00Z' }),
    makeColumn({ id: 'x1', board_id: 'other', title: 'Чужая', position: 1 }),
  ];

  test('are the live columns of the board in order, a preset by its word', () => {
    expect(columnLanes(columns, BOARD, presetName)).toEqual([
      { key: 'c1', name: '[open]', stage: 'open' },
      { key: 'c2', name: 'Ждём', stage: 'in_progress' },
    ]);
  });

  test('are the four stages on «Назначено мне»', () => {
    expect(stageLanes(presetName).map((lane) => lane.key)).toEqual([
      'open',
      'assigned',
      'in_progress',
      'resolved',
    ]);
  });

  test('a card stands in its column; one deleted meanwhile, in the first of its stage', () => {
    const lanes = columnLanes(columns, BOARD, presetName);
    expect(laneOfCard({ column_id: 'c2', column_key: 'in_progress' }, lanes)).toBe('c2');
    expect(laneOfCard({ column_id: 'c3', column_key: 'in_progress' }, lanes)).toBe('c2');
    expect(laneOfCard({ column_id: 'c3', column_key: 'resolved' }, lanes)).toBe('c1');
  });

  test('«Назначено мне» drops the cards of a board archived, keeps those of a board not seen', () => {
    const card = (board: { archived_at: string | null } | null) => ({ board });
    const live = card({ archived_at: null });
    const hidden = card(null);
    expect(onLiveBoards([live, card({ archived_at: '2026-11-20T10:00:00Z' }), hidden])).toEqual([
      live,
      hidden,
    ]);
  });
});

/** A client that records what is asked of it and answers nothing. */
function recordingClient() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const selects: string[] = [];
  const query: Record<string, unknown> = {};
  for (const name of ['eq', 'in', 'is', 'order', 'range', 'maybeSingle']) {
    query[name] = vi.fn(() => query);
  }
  query.select = vi.fn((columns: string) => {
    selects.push(columns);
    return query;
  });
  query.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null, count: 0 });
  const from = vi.fn(() => query);
  const client = { rpc, from } as unknown as Client;
  return { client, rpc, selects, from, query };
}

describe('the calls', () => {
  test('a new card sends its column by id, its steps, and null for no date, place or colour', async () => {
    const { client, rpc } = recordingClient();
    await saveCard(client, {
      cardId: CARD,
      boardId: BOARD,
      columnId: COLUMN,
      steps: ['a', 'b'],
      fields: { title: ' T ', description: 'd', dueOn: null, propertyId: null, color: null },
    });
    expect(rpc).toHaveBeenCalledWith('save_manager_card', {
      p_id: CARD,
      p_board_id: BOARD,
      p_title: 'T',
      p_description: 'd',
      p_due_on: null,
      p_property_id: null,
      p_color: null,
      p_column_id: COLUMN,
      p_steps: ['a', 'b'],
    });
  });

  test('a saved card sends no column and no steps: they have functions of their own', async () => {
    const { client, rpc } = recordingClient();
    await saveCard(client, {
      cardId: CARD,
      boardId: BOARD,
      fields: { title: 'T', description: '', dueOn: '2026-11-20', propertyId: 7, color: 'teal' },
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('p_column');
    expect(args).not.toHaveProperty('p_column_id');
    expect(args).not.toHaveProperty('p_steps');
    expect(args).toMatchObject({ p_due_on: '2026-11-20', p_property_id: 7, p_color: 'teal' });
  });

  test('a move names the column by id; from «Назначено мне», the stage alone', async () => {
    const { client, rpc } = recordingClient();
    await moveCard(client, { cardId: CARD, columnId: COLUMN, stage: 'resolved' });
    await moveCard(client, { cardId: CARD, stage: 'in_progress' });
    expect(rpc.mock.calls).toEqual([
      ['move_manager_card', { p_id: CARD, p_column_id: COLUMN }],
      ['move_manager_card', { p_id: CARD, p_column: 'in_progress' }],
    ]);
  });

  test('a board is saved with who sees it, or without a word about it', async () => {
    const { client, rpc } = recordingClient();
    await saveBoard(client, { boardId: BOARD, title: ' Проекты ', shared: false });
    await saveBoard(client, { boardId: BOARD, title: 'Проекты', shared: true });
    await saveBoard(client, { boardId: BOARD, title: 'Проекты' });
    expect(rpc.mock.calls).toEqual([
      ['save_manager_board', { p_id: BOARD, p_title: 'Проекты', p_shared: false }],
      ['save_manager_board', { p_id: BOARD, p_title: 'Проекты', p_shared: true }],
      ['save_manager_board', { p_id: BOARD, p_title: 'Проекты' }],
    ]);
  });

  test('a board is handed over, and its columns are added, renamed, ordered, marked, deleted', async () => {
    const { client, rpc } = recordingClient();
    await transferBoard(client, { boardId: BOARD, toId: 'manager' });
    await saveColumn(client, { columnId: COLUMN, boardId: BOARD, title: ' Счета ' });
    await saveColumn(client, { columnId: COLUMN, boardId: null, title: 'Договоры' });
    await orderColumns(client, { boardId: BOARD, columnIds: [TARGET, COLUMN] });
    await setColumnDone(client, { columnId: COLUMN, done: true });
    await deleteColumn(client, { columnId: COLUMN, moveToId: null });
    await deleteColumn(client, { columnId: COLUMN, moveToId: TARGET });
    expect(rpc.mock.calls).toEqual([
      ['transfer_manager_board', { p_id: BOARD, p_to: 'manager' }],
      ['save_manager_board_column', { p_id: COLUMN, p_board_id: BOARD, p_title: 'Счета' }],
      ['save_manager_board_column', { p_id: COLUMN, p_board_id: null, p_title: 'Договоры' }],
      ['order_manager_board_columns', { p_board_id: BOARD, p_ids: [TARGET, COLUMN] }],
      ['set_manager_board_column_done', { p_id: COLUMN, p_done: true }],
      ['delete_manager_board_column', { p_id: COLUMN }],
      ['delete_manager_board_column', { p_id: COLUMN, p_move_to: TARGET }],
    ]);
  });

  test('shelves, orders and comments call their functions', async () => {
    const { client, rpc } = recordingClient();
    await setCardShelf(client, { cardId: CARD, shelf: 'deleted' });
    await orderSteps(client, { cardId: CARD, stepIds: ['s2', 's1'] });
    await saveComment(client, { entryId: 'e1', cardId: CARD, body: ' hi ' });
    await deleteComment(client, 'e1');
    expect(rpc.mock.calls).toEqual([
      ['set_manager_card_state', { p_id: CARD, p_state: 'deleted' }],
      ['order_manager_steps', { p_card_id: CARD, p_ids: ['s2', 's1'] }],
      ['save_manager_comment', { p_id: 'e1', p_card_id: CARD, p_body: 'hi' }],
      ['delete_manager_comment', { p_id: 'e1' }],
    ]);
  });

  test("a change of a step's or a comment's words names no card; an add names it", async () => {
    const { client, rpc } = recordingClient();
    await saveStep(client, { stepId: 's1', cardId: null, body: ' new words ' });
    await saveComment(client, { entryId: 'e1', cardId: null, body: 'changed' });
    await saveStep(client, { stepId: 's2', cardId: CARD, body: 'added' });
    expect(rpc.mock.calls).toEqual([
      ['save_manager_step', { p_id: 's1', p_card_id: null, p_body: 'new words' }],
      ['save_manager_comment', { p_id: 'e1', p_card_id: null, p_body: 'changed' }],
      ['save_manager_step', { p_id: 's2', p_card_id: CARD, p_body: 'added' }],
    ]);
  });

  test('a refusal reaches the caller with its key', async () => {
    const { client, rpc } = recordingClient();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'x', hint: 'serverErrors.boardNotYours' },
    });
    await expect(moveCard(client, { cardId: CARD, stage: 'open' })).rejects.toMatchObject({
      hint: 'serverErrors.boardNotYours',
    });
  });

  test('the reads ask for the steps and the journal with their people', async () => {
    const { client, selects } = recordingClient();
    await fetchBoards(client);
    await fetchBoardCards(client, BOARD).catch(() => undefined);
    await fetchCard(client, CARD).catch(() => undefined);
    expect(selects[0]).toContain('owner:profiles!manager_boards_owner_id_fkey(full_name)');
    expect(selects[0]).toContain('shared');
    expect(selects[1]).toContain('steps:manager_board_steps(id, body, done_at)');
    expect(selects[1]).toContain('column_id');
    expect(selects[2]).toContain('entries:manager_board_entries(');
    expect(selects[2]).toContain('author:profiles!manager_board_entries_author_id_fkey(full_name)');
  });

  test('the columns are read for the boards named, the deleted ones too; none named, none asked', async () => {
    const { client, from, query } = recordingClient();
    expect(await fetchBoardColumns(client, [])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
    await fetchBoardColumns(client, [BOARD]);
    expect(from).toHaveBeenCalledWith('manager_board_columns');
    expect(query.in).toHaveBeenCalledWith('board_id', [BOARD]);
    expect(query.is).not.toHaveBeenCalled();
  });

  test('«Назначено мне» keeps a card whose board the viewer does not see', async () => {
    const { client, selects, query } = recordingClient();
    await fetchMyCards(client, 'viewer');
    expect(selects[0]).toContain('board:manager_boards(id, title, owner_id, archived_at)');
    expect(selects[0]).not.toContain('!inner');
    expect(query.is).not.toHaveBeenCalledWith('board.archived_at', null);
  });
});

describe('the address of «Назначено мне»', () => {
  test('reads ?board=mine with a card, and never an archive view', () => {
    expect(
      readBoardAddress(
        new URLSearchParams('board=mine&shelf=archive&card=b0a2d200-0000-4000-8000-000000000001'),
      ),
    ).toEqual({
      boardId: MY_CARDS,
      view: 'board',
      cardId: 'b0a2d200-0000-4000-8000-000000000001',
    });
    expect(writeBoardAddress({ boardId: MY_CARDS, view: 'board', cardId: null })).toBe(
      'board=mine',
    );
    expect(boardHref(MY_CARDS)).toBe('/problems?board=mine');
  });

  test('a board named otherwise than by an id is no board', () => {
    expect(readBoardAddress(new URLSearchParams('board=mine2')).boardId).toBeNull();
  });
});
