import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { BoardColumn, CardColor, Database } from '@str-ops/shared';

import { fetchAllPages } from '@/lib/fetch-all-pages';

import {
  boardCardListSchema,
  boardColumnRowListSchema,
  boardListSchema,
  cardDetailSchema,
  myCardListSchema,
  officePeopleSchema,
  onLiveBoards,
  type Board,
  type BoardCard,
  type CardDetail,
  type CardShelf,
  type ColumnRow,
  type MyCard,
  type OfficePerson,
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
  | 'transfer_manager_board'
  | 'set_manager_board_archived'
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
  | 'set_manager_card_assignee'
  | 'delete_archived_board'
  | 'delete_shelved_board_card';

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
  'id, title, owner_id, archived_at, created_at, shared, ' +
  'owner:profiles!manager_boards_owner_id_fkey(full_name)';

const COLUMN_SELECT =
  'id, board_id, title, preset, position, is_done, legacy_key, deleted_at, created_at';

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

/**
 * Every board of the company the viewer sees — shared ones, his own, all of them for an admin
 * (20261126120000) — the archived ones too, oldest first. Row level security draws the line.
 */
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

/**
 * Every column of these boards (20261126120000) — the deleted ones too, which the journal still
 * names — in their order. Read for a board the viewer sees, and for the board of a card given to
 * him on one he does not.
 */
export async function fetchBoardColumns(
  client: Client,
  boardIds: readonly string[],
): Promise<ColumnRow[]> {
  if (boardIds.length === 0) {
    return [];
  }
  const rows = await fetchAllPages((from, to, withCount) =>
    client
      .from('manager_board_columns')
      .select(COLUMN_SELECT, withCount ? { count: 'exact' } : undefined)
      .in('board_id', [...boardIds])
      .order('position', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return boardColumnRowListSchema.parse(rows);
}

// No `!inner`: a card given to the viewer on a board he does not see comes with `board: null`
// (20261126120000), where an inner embed would drop it. Whether a board he sees is archived is
// therefore read here, not filtered on the server (a filter on the embed would null it alike).
const MY_CARD_SELECT = `${CARD_SELECT}, board:manager_boards(id, title, owner_id, archived_at)`;

/**
 * «Назначено мне»: the cards the viewer is the assignee of, on every board of the company that is
 * not archived — the boards he sees, and the private boards of others where a card is his — and
 * neither archived nor deleted themselves.
 */
export async function fetchMyCards(client: Client, viewerId: string): Promise<MyCard[]> {
  const rows = await fetchAllPages((from, to, withCount) =>
    client
      .from('manager_board_cards')
      .select(MY_CARD_SELECT, withCount ? { count: 'exact' } : undefined)
      .eq('assignee_id', viewerId)
      .is('archived_at', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return onLiveBoards(myCardListSchema.parse(rows));
}

/**
 * The company's people by name, role and whether active: the journal names anybody it holds an id
 * of (switched off since, too); a card is given to `assignablePeople` of them.
 */
export async function fetchOfficePeople(client: Client): Promise<OfficePerson[]> {
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, role, is_active')
    .order('full_name', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return officePeopleSchema.parse(data ?? []);
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
  /**
   * Whether the other managers see it (20261126120000). Absent says nothing: a new board is then
   * its owner's alone, a saved one keeps what it was.
   */
  shared?: boolean;
}

/** Creates a board (the caller owns it), or renames it and changes who sees it. */
export async function saveBoard(client: Client, variables: SaveBoardVariables): Promise<void> {
  await call(client, 'save_manager_board', {
    p_id: variables.boardId,
    p_title: variables.title.trim(),
    ...(variables.shared === undefined ? {} : { p_shared: variables.shared }),
  });
}

/** Hands the board to another active manager or admin of the company: its owner or an admin. */
export async function transferBoard(
  client: Client,
  variables: { boardId: string; toId: string },
): Promise<void> {
  await call(client, 'transfer_manager_board', { p_id: variables.boardId, p_to: variables.toId });
}

export interface SaveColumnVariables {
  /** Minted by the panel for a new column: a repeat after a lost answer is the same column. */
  columnId: string;
  /** The board a new column is added to, at its end; null renames the column. */
  boardId: string | null;
  title: string;
}

/** Adds a column at the end of a board, or renames one. */
export async function saveColumn(client: Client, variables: SaveColumnVariables): Promise<void> {
  await call(client, 'save_manager_board_column', {
    p_id: variables.columnId,
    p_board_id: variables.boardId,
    p_title: variables.title.trim(),
  });
}

/** Puts a board's live columns in this order: every one of them, once. */
export async function orderColumns(
  client: Client,
  variables: { boardId: string; columnIds: readonly string[] },
): Promise<void> {
  await call(client, 'order_manager_board_columns', {
    p_board_id: variables.boardId,
    p_ids: variables.columnIds,
  });
}

/** Marks a column finishing — its cards are done — or not. */
export async function setColumnDone(
  client: Client,
  variables: { columnId: string; done: boolean },
): Promise<void> {
  await call(client, 'set_manager_board_column_done', {
    p_id: variables.columnId,
    p_done: variables.done,
  });
}

export interface DeleteColumnVariables {
  columnId: string;
  /** Where its cards go — another live column of the board; none for a column without cards. */
  moveToId: string | null;
}

/** Deletes a column, its cards moved to another first. */
export async function deleteColumn(
  client: Client,
  variables: DeleteColumnVariables,
): Promise<void> {
  await call(client, 'delete_manager_board_column', {
    p_id: variables.columnId,
    ...(variables.moveToId === null ? {} : { p_move_to: variables.moveToId }),
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

/**
 * «Удалить доску навсегда» (an admin, an archived board; 20261126150000): the board with every card,
 * step, journal, column and transfer. False: it was gone already.
 */
export async function deleteArchivedBoard(client: Client, boardId: string): Promise<boolean> {
  return (await call(client, 'delete_archived_board', { p_id: boardId })) === true;
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
  /**
   * Read on the create only: the board's column it is added in, by id (20261126120000). A save of
   * the fields names none — a card named with a column is a repeat of its create.
   */
  columnId?: string;
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
    ...(variables.columnId === undefined ? {} : { p_column_id: variables.columnId }),
    ...(variables.steps === undefined ? {} : { p_steps: variables.steps }),
  });
}

/** Gives the card to an active manager or admin of the company, or to nobody (null). */
export async function setCardAssignee(
  client: Client,
  variables: { cardId: string; assigneeId: string | null },
): Promise<void> {
  await call(client, 'set_manager_card_assignee', {
    p_id: variables.cardId,
    p_assignee_id: variables.assigneeId,
  });
}

/**
 * Where a card goes (20261126120000): a column of its board by id — with that column's stage, which
 * the card reads as at once — or, from «Назначено мне», a stage alone: the server lands it in the
 * board's first column of that stage.
 */
export type MoveCardVariables =
  | { cardId: string; columnId: string; stage: BoardColumn }
  | { cardId: string; columnId?: undefined; stage: BoardColumn };

export async function moveCard(client: Client, variables: MoveCardVariables): Promise<void> {
  await call(
    client,
    'move_manager_card',
    variables.columnId === undefined
      ? { p_id: variables.cardId, p_column: variables.stage }
      : { p_id: variables.cardId, p_column_id: variables.columnId },
  );
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

/**
 * «Удалить навсегда» (an admin, an archived or deleted card; 20261126150000): the card with its steps
 * and journal. False: it was gone already.
 */
export async function deleteShelvedCard(client: Client, cardId: string): Promise<boolean> {
  return (await call(client, 'delete_shelved_board_card', { p_id: cardId })) === true;
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
