import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { BoardColumn, CardColor, Database } from '@str-ops/shared';

import { fetchAllPages } from '@/lib/fetch-all-pages';

import {
  boardCardListSchema,
  boardListSchema,
  cardDetailSchema,
  type Board,
  type BoardCard,
  type CardDetail,
  type CardShelf,
} from './schema';

export type Client = SupabaseClient<Database>;

/**
 * The board functions (20261118200000). The generated types call every
 * argument without a default non-null, and a card's due date, place and
 * colour are null when it has none — so the calls go through one typed door,
 * as keyRpc and oauthRpc do.
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

function boardRpc(client: Client): BoardRpc {
  return client.rpc.bind(client) as unknown as BoardRpc;
}

async function call(
  client: Client,
  fn: BoardFunction,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await boardRpc(client)(fn, args);
  if (error) {
    throw error;
  }
  return data;
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

/** Every board of the company, the archived ones too, oldest first. Row level security draws the line. */
export async function fetchBoards(client: Client): Promise<Board[]> {
  const { data, error } = await client
    .from('manager_boards')
    .select(BOARD_SELECT)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return boardListSchema.parse(data ?? []);
}

/** Every card of one board — on it, archived and deleted — with its steps. */
export async function fetchBoardCards(client: Client, boardId: string): Promise<BoardCard[]> {
  const rows = await fetchAllPages((from, to, withCount) =>
    client
      .from('manager_board_cards')
      .select(CARD_SELECT, withCount ? { count: 'exact' } : undefined)
      .eq('board_id', boardId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return boardCardListSchema.parse(rows);
}

/** One card with its steps and its journal; null when there is no such card to see. */
export async function fetchCard(client: Client, cardId: string): Promise<CardDetail | null> {
  const { data, error } = await client
    .from('manager_board_cards')
    .select(CARD_DETAIL_SELECT)
    .eq('id', cardId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? null : cardDetailSchema.parse(data);
}

export interface SaveBoardVariables {
  boardId: string;
  title: string;
}

/** Creates a board (the caller owns it) or renames it. */
export async function saveBoard(client: Client, variables: SaveBoardVariables): Promise<void> {
  await call(client, 'save_manager_board', {
    p_id: variables.boardId,
    p_title: variables.title.trim(),
  });
}

export async function setBoardArchived(
  client: Client,
  variables: { boardId: string; archived: boolean },
): Promise<void> {
  await call(client, 'set_manager_board_archived', {
    p_id: variables.boardId,
    p_archived: variables.archived,
  });
}

/** The fields of a card as its form holds them. */
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
  /** Read on the create only: the column it is added in. */
  column?: BoardColumn;
  /** Read on the create only: the steps it starts with, in order. */
  steps?: readonly string[];
}

/** Creates a card with its steps, or saves its fields. */
export async function saveCard(client: Client, variables: SaveCardVariables): Promise<void> {
  const { fields } = variables;
  await call(client, 'save_manager_card', {
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

export async function moveCard(
  client: Client,
  variables: { cardId: string; column: BoardColumn },
): Promise<void> {
  await call(client, 'move_manager_card', { p_id: variables.cardId, p_column: variables.column });
}

export async function setCardShelf(
  client: Client,
  variables: { cardId: string; shelf: CardShelf },
): Promise<void> {
  await call(client, 'set_manager_card_state', {
    p_id: variables.cardId,
    p_state: variables.shelf,
  });
}

export async function duplicateCard(
  client: Client,
  variables: { sourceId: string; cardId: string; title: string },
): Promise<void> {
  await call(client, 'duplicate_manager_card', {
    p_source_id: variables.sourceId,
    p_id: variables.cardId,
    p_title: variables.title.trim(),
  });
}

/** Adds a step to the card `cardId` names; with `cardId` null, changes the step's words. */
export async function saveStep(
  client: Client,
  variables: { stepId: string; cardId: string | null; body: string },
): Promise<void> {
  await call(client, 'save_manager_step', {
    p_id: variables.stepId,
    p_card_id: variables.cardId,
    p_body: variables.body.trim(),
  });
}

export async function setStepDone(
  client: Client,
  variables: { stepId: string; done: boolean },
): Promise<void> {
  await call(client, 'set_manager_step_done', { p_id: variables.stepId, p_done: variables.done });
}

export async function deleteStep(client: Client, stepId: string): Promise<void> {
  await call(client, 'delete_manager_step', { p_id: stepId });
}

export async function orderSteps(
  client: Client,
  variables: { cardId: string; stepIds: readonly string[] },
): Promise<void> {
  await call(client, 'order_manager_steps', {
    p_card_id: variables.cardId,
    p_ids: variables.stepIds,
  });
}

/** Writes a comment on the card `cardId` names; with `cardId` null, its author changes its words. */
export async function saveComment(
  client: Client,
  variables: { entryId: string; cardId: string | null; body: string },
): Promise<void> {
  await call(client, 'save_manager_comment', {
    p_id: variables.entryId,
    p_card_id: variables.cardId,
    p_body: variables.body.trim(),
  });
}

export async function deleteComment(client: Client, entryId: string): Promise<void> {
  await call(client, 'delete_manager_comment', { p_id: entryId });
}
