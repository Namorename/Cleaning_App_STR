import type { BoardColumn } from '@str-ops/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { useRole } from '@/features/auth/use-role';
import { readCached } from '@/lib/read-cached';

import {
  deleteComment,
  deleteStep,
  duplicateCard,
  fetchBoardCards,
  fetchBoards,
  fetchCard,
  fetchMyCards,
  moveCard,
  orderSteps,
  saveBoard,
  saveCard,
  saveComment,
  saveStep,
  setBoardArchived,
  setCardAssignee,
  setCardShelf,
  setStepDone,
} from './api';
import {
  boardCardListSchema,
  boardListSchema,
  myCardListSchema,
  oneCardSchema,
  type Board,
  type BoardCard,
  type BoardViewer,
  type CardDetail,
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
};

/** Restored from disk in whatever shape the build that saved it read (`readCached`). */
function readBoards(data: unknown): Board[] {
  return readCached(boardListSchema, data, 'boards');
}

function readCards(data: unknown): BoardCard[] {
  return readCached(boardCardListSchema, data, 'board cards');
}

function readMine(data: unknown): MyCard[] {
  return readCached(myCardListSchema, data, 'my board cards');
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

/**
 * A move shows at once in the list on screen — a board's cards, or «Назначено мне» for a null
 * board — and goes back if the server refuses.
 */
export function useMoveCard(boardId: string | null) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const key =
    boardId === null ? boardKeys.mine(userId ?? '') : boardKeys.cards(userId ?? '', boardId);
  return useMutation({
    ...WRITE,
    mutationFn: (variables: { cardId: string; column: BoardColumn }) => moveCard(variables),
    onMutate: async ({ cardId, column }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<unknown>(key);
      if (Array.isArray(before)) {
        queryClient.setQueryData<unknown>(
          key,
          before.map((card: { id?: unknown }) =>
            card.id === cardId ? { ...card, column_key: column } : card,
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
