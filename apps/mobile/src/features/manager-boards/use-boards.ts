import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { useRole } from '@/features/auth/use-role';
import { readCached } from '@/lib/read-cached';

import {
  deleteColumn,
  deleteComment,
  deleteStep,
  duplicateCard,
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
  setBoardArchived,
  setCardAssignee,
  setCardShelf,
  setColumnDone,
  setStepDone,
  transferBoard,
} from './api';
import {
  boardCardListSchema,
  boardColumnListSchema,
  boardListSchema,
  myCardListSchema,
  oneCardSchema,
  onLiveBoards,
  type Board,
  type BoardCard,
  type BoardViewer,
  type CardDetail,
  type ColumnRow,
  type MyCard,
} from './schema';

/**
 * The boards' keys, under `boards` and keyed by the person: a phone handed
 * from one manager to another starts from nothing of the first one's.
 */
export const boardKeys = {
  all: ['boards'] as const,
  list: (person: string) => ['boards', person, 'list'] as const,
  cards: (person: string, boardId: string) => ['boards', person, 'cards', boardId] as const,
  card: (person: string, cardId: string) => ['boards', person, 'card', cardId] as const,
  /** «Назначено мне» (20261118230000). */
  mine: (person: string) => ['boards', person, 'mine'] as const,
  /** A board's columns, the deleted ones too (20261126120000). */
  columns: (person: string, boardId: string) => ['boards', person, 'columns', boardId] as const,
};

/** Restored from disk in whatever shape the build that saved it read (`readCached`). */
function readBoards(data: unknown): Board[] {
  return readCached(boardListSchema, data, 'boards');
}

function readCards(data: unknown): BoardCard[] {
  return readCached(boardCardListSchema, data, 'board cards');
}

function readMine(data: unknown): MyCard[] {
  return onLiveBoards(readCached(myCardListSchema, data, 'my board cards'));
}

function readColumns(data: unknown): ColumnRow[] {
  return readCached(boardColumnListSchema, data, 'board columns');
}

function readCard(data: unknown): CardDetail | null {
  return readCached(oneCardSchema, data, 'board card');
}

/** Who looks at the boards: the signed-in person, and whether an admin. */
export function useViewer(): BoardViewer {
  const { userId } = useSession();
  const role = useRole();
  return { id: userId ?? '', isAdmin: role === 'admin' };
}

export function useBoards() {
  const { userId } = useSession();
  return useQuery({
    queryKey: boardKeys.list(userId ?? ''),
    queryFn: fetchBoards,
    select: readBoards,
    enabled: userId !== null,
  });
}

export function useBoardCards(boardId: string | null) {
  const { userId } = useSession();
  return useQuery({
    queryKey: boardKeys.cards(userId ?? '', boardId ?? ''),
    queryFn: () => fetchBoardCards(boardId ?? ''),
    select: readCards,
    enabled: userId !== null && boardId !== null,
  });
}

/** A board's columns — the live ones its cards stand in, the deleted ones its journal names. */
export function useBoardColumns(boardId: string | null) {
  const { userId } = useSession();
  return useQuery({
    queryKey: boardKeys.columns(userId ?? '', boardId ?? ''),
    queryFn: () => fetchBoardColumns(boardId ?? ''),
    select: readColumns,
    enabled: userId !== null && boardId !== null,
  });
}

/** «Назначено мне»: the signed-in person's cards on every live board. */
export function useMyCards() {
  const { userId } = useSession();
  return useQuery({
    queryKey: boardKeys.mine(userId ?? ''),
    queryFn: () => fetchMyCards(userId ?? ''),
    select: readMine,
    enabled: userId !== null,
  });
}

export function useCard(cardId: string) {
  const { userId } = useSession();
  return useQuery({
    queryKey: boardKeys.card(userId ?? '', cardId),
    queryFn: () => fetchCard(cardId),
    select: readCard,
    enabled: userId !== null,
  });
}

/**
 * A board write is the office's, with a signal: sent now, refused at once
 * without one — never parked for later, so nothing waits on the disk and
 * replays on a screen that moved on. Every board read is stale after it.
 */
const WRITE = { networkMode: 'always', retry: false } as const;

function useWrite<V>(write: (variables: V) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    ...WRITE,
    mutationFn: write,
    onSettled: () => queryClient.invalidateQueries({ queryKey: boardKeys.all }),
  });
}

export const useSaveBoard = () => useWrite(saveBoard);
export const useSetBoardArchived = () => useWrite(setBoardArchived);
export const useSaveCard = () => useWrite(saveCard);
export const useSetCardShelf = () => useWrite(setCardShelf);
export const useDuplicateCard = () => useWrite(duplicateCard);
export const useSaveStep = () => useWrite(saveStep);
export const useDeleteStep = () => useWrite(deleteStep);
export const useOrderSteps = () => useWrite(orderSteps);
export const useSaveComment = () => useWrite(saveComment);
export const useDeleteComment = () => useWrite(deleteComment);
export const useSetCardAssignee = () => useWrite(setCardAssignee);
export const useTransferBoard = () => useWrite(transferBoard);
export const useSaveColumn = () => useWrite(saveColumn);
export const useOrderColumns = () => useWrite(orderColumns);
export const useSetColumnDone = () => useWrite(setColumnDone);
export const useDeleteColumn = () => useWrite(deleteColumn);

/** Where a card moves: the column, by id, and the stage the server keeps its cards' key as. */
export interface MoveCardVariables {
  cardId: string;
  column: Pick<ColumnRow, 'id' | 'legacy_key'>;
}

/** A move shows at once on the board's list, and goes back if the server refuses. */
export function useMoveCard(boardId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const key = boardKeys.cards(userId ?? '', boardId);
  return useMutation({
    ...WRITE,
    mutationFn: ({ cardId, column }: MoveCardVariables) =>
      moveCard({ cardId, columnId: column.id }),
    onMutate: async ({ cardId, column }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<unknown>(key);
      if (Array.isArray(before)) {
        queryClient.setQueryData<unknown>(
          key,
          before.map((card: { id?: unknown }) =>
            card.id === cardId
              ? { ...card, column_id: column.id, column_key: column.legacy_key }
              : card,
          ),
        );
      }
      return { before };
    },
    onError: (_error, _variables, context) => {
      if (context?.before !== undefined) {
        queryClient.setQueryData(key, context.before);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: boardKeys.all }),
  });
}

/** A tick shows at once on the card, and goes back if the server refuses. */
export function useSetStepDone(cardId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const key = boardKeys.card(userId ?? '', cardId);
  return useMutation({
    ...WRITE,
    mutationFn: (variables: { stepId: string; done: boolean }) => setStepDone(variables),
    onMutate: async ({ stepId, done }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<unknown>(key);
      const card = oneCardSchema.safeParse(before);
      if (card.success && card.data !== null) {
        queryClient.setQueryData<unknown>(key, {
          ...card.data,
          steps: card.data.steps.map((step) =>
            step.id === stepId
              ? { ...step, done_at: done ? new Date().toISOString() : null }
              : step,
          ),
        });
      }
      return { before };
    },
    onError: (_error, _variables, context) => {
      if (context?.before !== undefined) {
        queryClient.setQueryData(key, context.before);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: boardKeys.all }),
  });
}
