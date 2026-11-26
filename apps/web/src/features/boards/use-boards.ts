'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import {
  deleteArchivedBoard,
  deleteColumn,
  deleteComment,
  deleteShelvedCard,
  deleteStep,
  duplicateCard,
  fetchBoardCards,
  fetchBoardColumns,
  fetchBoards,
  fetchCard,
  fetchMyCards,
  fetchOfficePeople,
  moveCard,
  orderColumns,
  orderSteps,
  saveBoard,
  saveCard,
  saveColumn,
  saveComment,
  saveStep,
  setBoardArchived,
  setCardAssignee,
  setCardShelf,
  setColumnDone,
  setStepDone,
  transferBoard,
  type DeleteColumnVariables,
  type MoveCardVariables,
  type SaveBoardVariables,
  type SaveCardVariables,
  type SaveColumnVariables,
} from './api';
import { boardKeys } from './keys';
import type { Board, BoardCard, CardDetail, CardShelf, ColumnRow } from './schema';

export function useBoards() {
  const client = useSupabase();
  return useQuery({ queryKey: boardKeys.list(), queryFn: () => fetchBoards(client) });
}

/** The cards of one board; idle while no board is open. */
export function useBoardCards(boardId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: boardKeys.cards(boardId ?? ''),
    queryFn: () => fetchBoardCards(client, boardId ?? ''),
    enabled: boardId !== null,
  });
}

/**
 * A board's columns, the deleted ones too (20261126120000); idle while no board is named. Read for
 * a board on screen, and for the board of a card open — one the viewer may not see.
 */
export function useBoardColumns(boardId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: boardKeys.columns(boardId ?? ''),
    queryFn: () => fetchBoardColumns(client, boardId === null ? [] : [boardId]),
    enabled: boardId !== null,
  });
}

/**
 * The columns of the boards named, the deleted ones too — «Назначено мне», whose cards come from
 * many boards, some of them not the viewer's to see (their columns are read for a card given to
 * him). Idle while none is named.
 */
export function useBoardColumnsOf(boardIds: readonly string[]) {
  const client = useSupabase();
  const key = boardKeys.columnsOf(boardIds);
  return useQuery({
    queryKey: key,
    queryFn: () => fetchBoardColumns(client, key.slice(3)),
    enabled: boardIds.length > 0,
  });
}

/** One card with its steps and journal; idle while no card is open. */
export function useCard(cardId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: boardKeys.card(cardId ?? ''),
    queryFn: () => fetchCard(client, cardId ?? ''),
    enabled: cardId !== null,
  });
}

/** «Назначено мне»: the viewer's cards on every live board. */
export function useMyCards(viewerId: string) {
  const client = useSupabase();
  return useQuery({
    queryKey: boardKeys.mine(viewerId),
    queryFn: () => fetchMyCards(client, viewerId),
  });
}

/** The company's active managers and admins: who a card can be given to, and who its journal names. */
export function useOfficePeople() {
  const client = useSupabase();
  return useQuery({ queryKey: boardKeys.people(), queryFn: () => fetchOfficePeople(client) });
}

/** What a write leaves stale: the list of boards, a board's cards, the card open, the columns. */
type Stale = 'boards' | 'cards' | 'card' | 'columns';

const STALE_KEY: Readonly<Record<Stale, readonly string[]>> = {
  boards: boardKeys.list(),
  cards: ['boards', 'cards'],
  card: ['boards', 'card'],
  columns: ['boards', 'columns'],
};

/**
 * What a change of a board's columns leaves stale: the columns, and the cards — an added, ordered,
 * finishing or deleted column changes the stages the server keeps for them (column_key), and a
 * deletion moves cards and writes their journals.
 */
const COLUMN_STALE: readonly Stale[] = ['columns', 'cards', 'card'];

/**
 * Marks what a write changed as stale — only that: a tick does not read the
 * company's boards again. Not awaited: a write is over when the server
 * answers, and its field is free for the next one while the reads run.
 */
function useInvalidate(...parts: Stale[]) {
  const queryClient = useQueryClient();
  return () => {
    for (const part of parts) {
      void queryClient.invalidateQueries({ queryKey: STALE_KEY[part] });
    }
  };
}

export function useSaveBoard() {
  const client = useSupabase();
  const invalidate = useInvalidate('boards');
  return useMutation({
    mutationFn: (variables: SaveBoardVariables) => saveBoard(client, variables),
    onSettled: invalidate,
  });
}

export function useSetBoardArchived() {
  const client = useSupabase();
  const invalidate = useInvalidate('boards');
  return useMutation({
    mutationFn: (variables: { boardId: string; archived: boolean }) =>
      setBoardArchived(client, variables),
    onSettled: invalidate,
  });
}

/**
 * Hands a board over (20261126120000): the list reads it again — a private board leaves the list
 * of its former owner — and so do its cards, its columns and the card open, which he may no longer
 * see.
 */
export function useTransferBoard() {
  const client = useSupabase();
  const invalidate = useInvalidate('boards', 'cards', 'card', 'columns');
  return useMutation({
    mutationFn: (variables: { boardId: string; toId: string }) => transferBoard(client, variables),
    onSettled: invalidate,
  });
}

/**
 * Forgets a board the viewer no longer sees — a private board he handed over: it leaves the cached
 * list at once and its cards and columns are dropped, so the screen he goes to never shows it, nor
 * «Доска не найдена» while the list is read again.
 */
export function useForgetBoard() {
  const queryClient = useQueryClient();
  return (boardId: string) => {
    queryClient.setQueryData<Board[]>(boardKeys.list(), (boards) =>
      boards?.filter((board) => board.id !== boardId),
    );
    queryClient.removeQueries({ queryKey: boardKeys.cards(boardId) });
    queryClient.removeQueries({ queryKey: boardKeys.columns(boardId) });
  };
}

/**
 * «Удалить доску навсегда» (an admin, an archived board): the screen forgets it at once (useForgetBoard)
 * and leaves; the list and «Назначено мне» read again.
 */
export function useDeleteArchivedBoard() {
  const client = useSupabase();
  const invalidate = useInvalidate('boards', 'cards');
  return useMutation({
    mutationFn: (boardId: string) => deleteArchivedBoard(client, boardId),
    onSettled: invalidate,
  });
}

/** Adds a column or renames one: a rename leaves the columns alone stale, an add the cards too. */
export function useSaveColumn() {
  const client = useSupabase();
  const invalidateNames = useInvalidate('columns');
  const invalidateAll = useInvalidate(...COLUMN_STALE);
  return useMutation({
    mutationFn: (variables: SaveColumnVariables) => saveColumn(client, variables),
    onSettled: (_data, _error, variables) =>
      variables.boardId === null ? invalidateNames() : invalidateAll(),
  });
}

/** Passes every column of the board's cached list through `put`. */
function updateColumns(
  queryClient: QueryClient,
  boardId: string,
  put: (column: ColumnRow) => ColumnRow,
) {
  queryClient.setQueryData<ColumnRow[]>(boardKeys.columns(boardId), (columns) => columns?.map(put));
}

/** A new order of the columns shows at once, and goes back if the server refuses. */
export function useOrderColumns() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate(...COLUMN_STALE);
  return useMutation({
    mutationFn: (variables: { boardId: string; columnIds: readonly string[] }) =>
      orderColumns(client, variables),
    onMutate: async ({ boardId, columnIds }) => {
      const kept = [await keep(queryClient, boardKeys.columns(boardId))];
      updateColumns(queryClient, boardId, (column) => {
        const at = columnIds.indexOf(column.id);
        return at < 0 ? column : { ...column, position: at + 1 };
      });
      return kept;
    },
    onError: (_error, _variables, kept) => putBack(queryClient, kept),
    onSettled: invalidate,
  });
}

/** «Завершающая» shows at once on the column, and goes back if the server refuses. */
export function useSetColumnDone(boardId: string) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate(...COLUMN_STALE);
  return useMutation({
    mutationFn: (variables: { columnId: string; done: boolean }) =>
      setColumnDone(client, variables),
    onMutate: async ({ columnId, done }) => {
      const kept = [await keep(queryClient, boardKeys.columns(boardId))];
      updateColumns(queryClient, boardId, (column) =>
        column.id === columnId ? { ...column, is_done: done } : column,
      );
      return kept;
    },
    onError: (_error, _variables, kept) => putBack(queryClient, kept),
    onSettled: invalidate,
  });
}

export function useDeleteColumn() {
  const client = useSupabase();
  const invalidate = useInvalidate(...COLUMN_STALE);
  return useMutation({
    mutationFn: (variables: DeleteColumnVariables) => deleteColumn(client, variables),
    onSettled: invalidate,
  });
}

/**
 * A refused card write may name a column deleted meanwhile (boardColumnNotFound): the columns are
 * read again with the cards, so its lane leaves the board.
 */
function useInvalidateCardWrite() {
  const invalidate = useInvalidate('cards', 'card');
  const invalidateColumns = useInvalidate('columns');
  return (_data: unknown, error: unknown) => {
    invalidate();
    if (error !== null && error !== undefined) {
      invalidateColumns();
    }
  };
}

export function useSaveCard() {
  const client = useSupabase();
  const settle = useInvalidateCardWrite();
  return useMutation({
    mutationFn: (variables: SaveCardVariables) => saveCard(client, variables),
    onSettled: settle,
  });
}

/** A cache entry set aside before an optimistic change, put back if the server refuses. */
interface Kept {
  key: readonly unknown[];
  data: unknown;
}

async function keep(queryClient: QueryClient, key: readonly unknown[]): Promise<Kept> {
  await queryClient.cancelQueries({ queryKey: key });
  return { key, data: queryClient.getQueryData(key) };
}

function putBack(queryClient: QueryClient, kept: readonly Kept[] | undefined) {
  for (const { key, data } of kept ?? []) {
    if (data !== undefined) {
      queryClient.setQueryData(key, data);
    }
  }
}

/**
 * Where a moved card stands until the server answers: in the column named — by id, with its stage —
 * or, moved by a stage alone («Назначено мне»), under that stage in the column it had.
 */
function movedTo<T extends Pick<BoardCard, 'column_id' | 'column_key'>>(
  card: T,
  { columnId, stage }: MoveCardVariables,
): T {
  return { ...card, column_id: columnId ?? card.column_id, column_key: stage };
}

/**
 * A move shows at once — in the list on screen (a board's cards, or «Назначено мне») and on the
 * card open — while the server is asked, and goes back if it refuses.
 */
export function useMoveCard(listKey: readonly unknown[]) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const settle = useInvalidateCardWrite();
  return useMutation({
    mutationFn: (variables: MoveCardVariables) => moveCard(client, variables),
    onMutate: async (variables) => {
      const { cardId } = variables;
      const kept = [
        await keep(queryClient, listKey),
        await keep(queryClient, boardKeys.card(cardId)),
      ];
      queryClient.setQueryData<BoardCard[]>(listKey, (cards) =>
        cards?.map((card) => (card.id === cardId ? movedTo(card, variables) : card)),
      );
      queryClient.setQueryData<CardDetail | null>(boardKeys.card(cardId), (card) =>
        card === undefined || card === null ? card : movedTo(card, variables),
      );
      return kept;
    },
    onError: (_error, _variables, kept) => putBack(queryClient, kept),
    onSettled: settle,
  });
}

/** Gives a card to somebody, or to nobody: the boards and the card read it again. */
export function useSetCardAssignee() {
  const client = useSupabase();
  const invalidate = useInvalidate('cards', 'card');
  return useMutation({
    mutationFn: (variables: { cardId: string; assigneeId: string | null }) =>
      setCardAssignee(client, variables),
    onSettled: invalidate,
  });
}

export function useSetCardShelf() {
  const client = useSupabase();
  const invalidate = useInvalidate('cards', 'card');
  return useMutation({
    mutationFn: (variables: { cardId: string; shelf: CardShelf }) =>
      setCardShelf(client, variables),
    onSettled: invalidate,
  });
}

/** «Удалить навсегда» (an admin, an archived or deleted card): the boards and the card read again. */
export function useDeleteShelvedCard() {
  const client = useSupabase();
  const invalidate = useInvalidate('cards', 'card');
  return useMutation({
    mutationFn: (cardId: string) => deleteShelvedCard(client, cardId),
    onSettled: invalidate,
  });
}

export function useDuplicateCard() {
  const client = useSupabase();
  const invalidate = useInvalidate('cards', 'card');
  return useMutation({
    mutationFn: (variables: { sourceId: string; cardId: string; title: string }) =>
      duplicateCard(client, variables),
    onSettled: invalidate,
  });
}

/** A step's write: the card and the board's progress and search are stale after it. */
export function useSaveStep() {
  const client = useSupabase();
  const invalidate = useInvalidate('cards', 'card');
  return useMutation({
    mutationFn: (variables: { stepId: string; cardId: string | null; body: string }) =>
      saveStep(client, variables),
    onSettled: invalidate,
  });
}

/** A tick shows at once on the open card, and goes back if the server refuses. */
export function useSetStepDone(cardId: string) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate('cards', 'card');
  const key = boardKeys.card(cardId);
  return useMutation({
    mutationFn: (variables: { stepId: string; done: boolean }) => setStepDone(client, variables),
    onMutate: async ({ stepId, done }) => {
      const kept = [await keep(queryClient, key)];
      queryClient.setQueryData<CardDetail | null>(key, (card) =>
        card === undefined || card === null
          ? card
          : {
              ...card,
              steps: card.steps.map((step) =>
                step.id === stepId
                  ? { ...step, done_at: done ? new Date().toISOString() : null }
                  : step,
              ),
            },
      );
      return kept;
    },
    onError: (_error, _variables, kept) => putBack(queryClient, kept),
    onSettled: invalidate,
  });
}

export function useDeleteStep() {
  const client = useSupabase();
  const invalidate = useInvalidate('cards', 'card');
  return useMutation({
    mutationFn: (stepId: string) => deleteStep(client, stepId),
    onSettled: invalidate,
  });
}

/** A new order shows at once on the open card, and goes back if the server refuses. */
export function useOrderSteps() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate('card');
  return useMutation({
    mutationFn: (variables: { cardId: string; stepIds: readonly string[] }) =>
      orderSteps(client, variables),
    onMutate: async ({ cardId, stepIds }) => {
      const key = boardKeys.card(cardId);
      const kept = [await keep(queryClient, key)];
      queryClient.setQueryData<CardDetail | null>(key, (card) =>
        card === undefined || card === null
          ? card
          : {
              ...card,
              steps: card.steps.map((step) => ({
                ...step,
                sort_order: stepIds.indexOf(step.id) + 1,
              })),
            },
      );
      return kept;
    },
    onError: (_error, _variables, kept) => putBack(queryClient, kept),
    onSettled: invalidate,
  });
}

/** A comment's write: only the card's journal is stale. */
export function useSaveComment() {
  const client = useSupabase();
  const invalidate = useInvalidate('card');
  return useMutation({
    mutationFn: (variables: { entryId: string; cardId: string | null; body: string }) =>
      saveComment(client, variables),
    onSettled: invalidate,
  });
}

export function useDeleteComment() {
  const client = useSupabase();
  const invalidate = useInvalidate('card');
  return useMutation({
    mutationFn: (entryId: string) => deleteComment(client, entryId),
    onSettled: invalidate,
  });
}
