import type { PostgrestError } from '@supabase/supabase-js';
import type { CardColor } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import type { CardShelf } from './schema';

/**
 * The board functions (20261118200000, 20261126120000). The generated types call every
 * argument without a default non-null, and a card's due date, place and
 * colour are null when it has none — so the calls go through one door with
 * their own types, as the panel's do.
 */
type BoardFunction =
  | 'save_manager_board'
  | 'set_manager_board_archived'
  | 'transfer_manager_board'
  | 'save_manager_board_column'
  | 'order_manager_board_columns'
  | 'set_manager_board_column_done'
  | 'delete_manager_board_column'
  | 'save_manager_card'
  | 'move_manager_card'
  | 'set_manager_card_state'
  | 'duplicate_manager_card'
  | 'save_manager_step'
  | 'set_manager_step_done'
  | 'delete_manager_step'
  | 'order_manager_steps'
  | 'save_manager_comment'
  | 'delete_manager_comment'
  | 'set_manager_card_assignee';

type BoardRpc = (
  fn: BoardFunction,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

async function call(fn: BoardFunction, args: Record<string, unknown>): Promise<void> {
  const rpc = supabase.rpc.bind(supabase) as unknown as BoardRpc;
  const { error } = await rpc(fn, args);
  if (error) {
    throw error;
  }
}

const BOARD_SELECT =
  'id, title, owner_id, archived_at, created_at, shared, ' +
  'owner:profiles!manager_boards_owner_id_fkey(full_name)';

const COLUMN_SELECT = 'id, board_id, title, preset, position, is_done, legacy_key, deleted_at';

const CARD_FIELDS =
  'id, board_id, title, description, column_id, column_key, color, due_on, property_id, ' +
  'created_at, moved_at, ' +
  'archived_at, deleted_at, property:properties(name, hostaway_unit_id, parent:parent_id(name)), ' +
  'assignee_id, assignee:profiles!manager_board_cards_assignee_id_fkey(full_name)';

const CARD_SELECT = `${CARD_FIELDS}, steps:manager_board_steps(id, body, done_at)`;

const CARD_DETAIL_SELECT =
  `${CARD_FIELDS}, created_by, creator:profiles!manager_board_cards_created_by_fkey(full_name), ` +
  'steps:manager_board_steps(id, body, sort_order, done_at), ' +
  'entries:manager_board_entries(id, kind, body, facts, author_id, created_at, edited_at, ' +
  'author:profiles!manager_board_entries_author_id_fkey(full_name))';

/** The most cards one board's read brings: far above any board a person keeps. */
export const BOARD_CARDS_LIMIT = 1000;

/** The most columns one board's read brings, the deleted ones among them: twelve live at most. */
export const BOARD_COLUMNS_READ_LIMIT = 500;

/**
 * Every board the person sees, oldest first: shared with the office, her own, or every one for an
 * admin (20261126120000). Row level security draws the line.
 */
export async function fetchBoards(): Promise<unknown> {
  const { data, error } = await supabase
    .from('manager_boards')
    .select(BOARD_SELECT)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return data ?? [];
}

/** One board's cards — on it, archived and deleted — with their steps. */
export async function fetchBoardCards(boardId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('manager_board_cards')
    .select(CARD_SELECT)
    .eq('board_id', boardId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(BOARD_CARDS_LIMIT);
  if (error) {
    throw error;
  }
  return data ?? [];
}

/**
 * One board's columns, the live ones first in their order, then the deleted ones: a card stands in
 * a live one, the journal names any (20261126120000). Read by whoever sees the board, or holds a
 * card on it.
 */
export async function fetchBoardColumns(boardId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('manager_board_columns')
    .select(COLUMN_SELECT)
    .eq('board_id', boardId)
    .order('deleted_at', { ascending: true, nullsFirst: true })
    .order('position', { ascending: true })
    .order('id', { ascending: true })
    .limit(BOARD_COLUMNS_READ_LIMIT);
  if (error) {
    throw error;
  }
  return data ?? [];
}

// Not `!inner`: a card given to her on a board she does not see comes with its board null
// (20261126120000), and an inner embed would drop it. Archived boards are dropped on the phone
// (`onLiveBoards`): a filter on the embed would only blank their board, as a hidden one.
const MY_CARD_SELECT = `${CARD_SELECT}, board:manager_boards(id, title, owner_id, archived_at)`;

/**
 * «Назначено мне»: the cards the person is the assignee of, neither archived nor deleted
 * themselves — of every board, the archived ones too (the phone drops those, `onLiveBoards`).
 */
export async function fetchMyCards(personId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('manager_board_cards')
    .select(MY_CARD_SELECT)
    .eq('assignee_id', personId)
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(BOARD_CARDS_LIMIT);
  if (error) {
    throw error;
  }
  return data ?? [];
}

/** One card with its steps and journal; null when there is none to see. */
export async function fetchCard(cardId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('manager_board_cards')
    .select(CARD_DETAIL_SELECT)
    .eq('id', cardId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

/**
 * Creates the board with its four columns, or renames it. `shared` says who sees it: absent, a new
 * board is its owner's alone and a rename leaves it as it is (20261126120000).
 */
export function saveBoard(variables: {
  boardId: string;
  title: string;
  shared?: boolean;
}): Promise<void> {
  return call('save_manager_board', {
    p_id: variables.boardId,
    p_title: variables.title.trim(),
    ...(variables.shared === undefined ? {} : { p_shared: variables.shared }),
  });
}

export function setBoardArchived(variables: { boardId: string; archived: boolean }): Promise<void> {
  return call('set_manager_board_archived', {
    p_id: variables.boardId,
    p_archived: variables.archived,
  });
}

/** Hands the board to another active manager or admin of the company: its new owner. */
export function transferBoard(variables: { boardId: string; ownerId: string }): Promise<void> {
  return call('transfer_manager_board', { p_id: variables.boardId, p_to: variables.ownerId });
}

/** Adds a column at the end of the board `boardId` names; with `boardId` null, renames it. */
export function saveColumn(variables: {
  columnId: string;
  boardId: string | null;
  title: string;
}): Promise<void> {
  return call('save_manager_board_column', {
    p_id: variables.columnId,
    p_board_id: variables.boardId,
    p_title: variables.title.trim(),
  });
}

/** Puts the board's live columns in this order: every one of them, once. */
export function orderColumns(variables: {
  boardId: string;
  columnIds: readonly string[];
}): Promise<void> {
  return call('order_manager_board_columns', {
    p_board_id: variables.boardId,
    p_ids: variables.columnIds,
  });
}

/** Marks a column finishing (its cards are done) or not. */
export function setColumnDone(variables: { columnId: string; done: boolean }): Promise<void> {
  return call('set_manager_board_column_done', {
    p_id: variables.columnId,
    p_done: variables.done,
  });
}

/** Deletes a column; the cards it holds move to `moveTo` first, which a column with cards needs. */
export function deleteColumn(variables: {
  columnId: string;
  moveTo: string | null;
}): Promise<void> {
  return call('delete_manager_board_column', {
    p_id: variables.columnId,
    ...(variables.moveTo === null ? {} : { p_move_to: variables.moveTo }),
  });
}

export interface CardFields {
  title: string;
  description: string;
  dueOn: string | null;
  propertyId: number | null;
  color: CardColor | null;
}

export interface SaveCardVariables {
  cardId: string;
  boardId: string;
  fields: CardFields;
  /** The column a new card goes to, by its id (20261126120000). Read on the create only. */
  columnId?: string;
  /** Read on the create only. */
  steps?: readonly string[];
}

/** Creates a card (a column named) or changes its fields (none named). */
export function saveCard(variables: SaveCardVariables): Promise<void> {
  const { fields } = variables;
  return call('save_manager_card', {
    p_id: variables.cardId,
    p_board_id: variables.boardId,
    p_title: fields.title.trim(),
    p_description: fields.description,
    p_due_on: fields.dueOn,
    p_property_id: fields.propertyId,
    p_color: fields.color,
    ...(variables.columnId === undefined ? {} : { p_column_id: variables.columnId }),
    ...(variables.steps === undefined ? {} : { p_steps: variables.steps }),
  });
}

/** Gives the card to an active manager or admin of the company, or to nobody (null). */
export function setCardAssignee(variables: {
  cardId: string;
  assigneeId: string | null;
}): Promise<void> {
  return call('set_manager_card_assignee', {
    p_id: variables.cardId,
    p_assignee_id: variables.assigneeId,
  });
}

/** Moves a card to a live column of its board, by the column's id (20261126120000). */
export function moveCard(variables: { cardId: string; columnId: string }): Promise<void> {
  return call('move_manager_card', { p_id: variables.cardId, p_column_id: variables.columnId });
}

export function setCardShelf(variables: { cardId: string; shelf: CardShelf }): Promise<void> {
  return call('set_manager_card_state', { p_id: variables.cardId, p_state: variables.shelf });
}

export function duplicateCard(variables: {
  sourceId: string;
  cardId: string;
  title: string;
}): Promise<void> {
  return call('duplicate_manager_card', {
    p_source_id: variables.sourceId,
    p_id: variables.cardId,
    p_title: variables.title.trim(),
  });
}

/** Adds a step to the card `cardId` names; with `cardId` null, changes the step's words. */
export function saveStep(variables: {
  stepId: string;
  cardId: string | null;
  body: string;
}): Promise<void> {
  return call('save_manager_step', {
    p_id: variables.stepId,
    p_card_id: variables.cardId,
    p_body: variables.body.trim(),
  });
}

export function setStepDone(variables: { stepId: string; done: boolean }): Promise<void> {
  return call('set_manager_step_done', { p_id: variables.stepId, p_done: variables.done });
}

export function deleteStep(stepId: string): Promise<void> {
  return call('delete_manager_step', { p_id: stepId });
}

export function orderSteps(variables: {
  cardId: string;
  stepIds: readonly string[];
}): Promise<void> {
  return call('order_manager_steps', { p_card_id: variables.cardId, p_ids: variables.stepIds });
}

/** Writes a comment on the card `cardId` names; with `cardId` null, its author changes its words. */
export function saveComment(variables: {
  entryId: string;
  cardId: string | null;
  body: string;
}): Promise<void> {
  return call('save_manager_comment', {
    p_id: variables.entryId,
    p_card_id: variables.cardId,
    p_body: variables.body.trim(),
  });
}

export function deleteComment(entryId: string): Promise<void> {
  return call('delete_manager_comment', { p_id: entryId });
}
