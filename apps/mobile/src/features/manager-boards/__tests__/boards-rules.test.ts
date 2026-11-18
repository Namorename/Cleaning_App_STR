import { t } from 'i18next';

import { moveCard, saveCard, saveComment, saveStep, setCardShelf } from '../api';
import { entrySentence } from '../format';
import {
  canDeleteComment,
  canEditBoard,
  canEditComment,
  cardEntrySchema,
  shelfOf,
  type BoardViewer,
} from '../schema';

/**
 * The phone's manager boards (20261118200000): who changes what — the same
 * rule as the server's and the panel's — the journal's facts said in words,
 * and what each write sends.
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
  test('a new card sends its column and steps, and null for no date, place or colour', async () => {
    await saveCard({
      cardId: 'c1',
      boardId: 'b1',
      column: 'open',
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
      p_column: 'open',
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
    expect(args).not.toHaveProperty('p_steps');
  });

  test('a move, a shelf and a comment call their functions; a refusal reaches the caller', async () => {
    await moveCard({ cardId: 'c1', column: 'resolved' });
    await setCardShelf({ cardId: 'c1', shelf: 'archived' });
    await saveComment({ entryId: 'e1', cardId: 'c1', body: ' hi ' });
    expect(mockRpc.mock.calls).toEqual([
      ['move_manager_card', { p_id: 'c1', p_column: 'resolved' }],
      ['set_manager_card_state', { p_id: 'c1', p_state: 'archived' }],
      ['save_manager_comment', { p_id: 'e1', p_card_id: 'c1', p_body: 'hi' }],
    ]);
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'x', hint: 'serverErrors.boardNotYours' },
    });
    await expect(moveCard({ cardId: 'c1', column: 'open' })).rejects.toMatchObject({
      hint: 'serverErrors.boardNotYours',
    });
  });
});
