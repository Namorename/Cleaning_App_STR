import type { PostgrestError } from '@supabase/supabase-js';
import type { BoardColumn, CardColor } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import type { CardShelf } from './schema';

/**
 * The board functions (20261118200000). The generated types call every
 * argument without a default non-null, and a card's due date, place and
 * colour are null when it has none — so the calls go through one door with
 * their own types, as the panel's do.
 */
type BoardFunction =
  | 'save_manager_board'
  | 'set_manager_board_archived'
  | 'save_manager_card'
  | 'move_manager_card'
  | 'set_manager_card_state'
  | 'duplicate_manager_card'
  | 'save_manager_step'
  | 'set_manager_step_done'
  | 'delete_manager_step'
  | 'order_manager_steps'
  | 'save_manager_comment'
  | 'delete_manager_comment';

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
  'id, title, owner_id, archived_at, created_at, owner:profiles!manager_boards_owner_id_fkey(full_name)';

const CARD_FIELDS =
  'id, board_id, title, description, column_key, color, due_on, property_id, created_at, moved_at, ' +
  'archived_at, deleted_at, property:properties(name, hostaway_unit_id, parent:parent_id(name))';

const CARD_SELECT = `${CARD_FIELDS}, steps:manager_board_steps(id, body, done_at)`;

const CARD_DETAIL_SELECT =
  `${CARD_FIELDS}, created_by, creator:profiles!manager_board_cards_created_by_fkey(full_name), ` +
  'steps:manager_board_steps(id, body, sort_order, done_at), ' +
  'entries:manager_board_entries(id, kind, body, facts, author_id, created_at, edited_at, ' +
  'author:profiles!manager_board_entries_author_id_fkey(full_name))';

/** The most cards one board's read brings: far above any board a person keeps. */
export const BOARD_CARDS_LIMIT = 1000;

/** Every board of the company, oldest first. Row level security draws the line: the office's. */
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

export function saveBoard(variables: { boardId: string; title: string }): Promise<void> {
  return call('save_manager_board', { p_id: variables.boardId, p_title: variables.title.trim() });
}

export function setBoardArchived(variables: { boardId: string; archived: boolean }): Promise<void> {
  return call('set_manager_board_archived', {
    p_id: variables.boardId,
    p_archived: variables.archived,
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
  /** Read on the create only. */
  column?: BoardColumn;
  /** Read on the create only. */
  steps?: readonly string[];
}

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
    ...(variables.column === undefined ? {} : { p_column: variables.column }),
    ...(variables.steps === undefined ? {} : { p_steps: variables.steps }),
  });
}

export function moveCard(variables: { cardId: string; column: BoardColumn }): Promise<void> {
  return call('move_manager_card', { p_id: variables.cardId, p_column: variables.column });
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

export function saveStep(variables: {
  stepId: string;
  cardId: string;
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

export function saveComment(variables: {
  entryId: string;
  cardId: string;
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
