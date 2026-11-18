'use client';

import type { BoardColumn } from '@str-ops/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import {
  deleteComment,
  deleteStep,
  duplicateCard,
  fetchBoardCards,
  fetchBoards,
  fetchCard,
  moveCard,
  orderSteps,
  saveBoard,
  saveCard,
  saveComment,
  saveStep,
  setBoardArchived,
  setCardShelf,
  setStepDone,
  type SaveBoardVariables,
  type SaveCardVariables,
} from './api';
import { boardKeys } from './keys';
import type { BoardCard, CardDetail, CardShelf } from './schema';

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

/** One card with its steps and journal; idle while no card is open. */
export function useCard(cardId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: boardKeys.card(cardId ?? ''),
    queryFn: () => fetchCard(client, cardId ?? ''),
    enabled: cardId !== null,
  });
}

/** After any write every board read is stale: boards, cards and the card open. */
function useInvalidateBoards() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: boardKeys.all });
}

export function useSaveBoard() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (variables: SaveBoardVariables) => saveBoard(client, variables),
    onSettled: invalidate,
  });
}

export function useSetBoardArchived() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (variables: { boardId: string; archived: boolean }) =>
      setBoardArchived(client, variables),
    onSettled: invalidate,
  });
}

export function useSaveCard() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (variables: SaveCardVariables) => saveCard(client, variables),
    onSettled: invalidate,
  });
}

/**
 * A move shows at once: the card stands in its new column while the server
 * is asked, and goes back if it refuses.
 */
export function useMoveCard(boardId: string) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBoards();
  const key = boardKeys.cards(boardId);
  return useMutation({
    mutationFn: (variables: { cardId: string; column: BoardColumn }) => moveCard(client, variables),
    onMutate: async ({ cardId, column }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<BoardCard[]>(key);
      queryClient.setQueryData<BoardCard[]>(key, (cards) =>
        cards?.map((card) => (card.id === cardId ? { ...card, column_key: column } : card)),
      );
      return { before };
    },
    onError: (_error, _variables, context) => {
      if (context?.before !== undefined) {
        queryClient.setQueryData(key, context.before);
      }
    },
    onSettled: invalidate,
  });
}

export function useSetCardShelf() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (variables: { cardId: string; shelf: CardShelf }) =>
      setCardShelf(client, variables),
    onSettled: invalidate,
  });
}

export function useDuplicateCard() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (variables: { sourceId: string; cardId: string; title: string }) =>
      duplicateCard(client, variables),
    onSettled: invalidate,
  });
}

export function useSaveStep() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
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
  const invalidate = useInvalidateBoards();
  const key = boardKeys.card(cardId);
  return useMutation({
    mutationFn: (variables: { stepId: string; done: boolean }) => setStepDone(client, variables),
    onMutate: async ({ stepId, done }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<CardDetail | null>(key);
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
      return { before };
    },
    onError: (_error, _variables, context) => {
      if (context?.before !== undefined) {
        queryClient.setQueryData(key, context.before);
      }
    },
    onSettled: invalidate,
  });
}

export function useDeleteStep() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (stepId: string) => deleteStep(client, stepId),
    onSettled: invalidate,
  });
}

export function useOrderSteps() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (variables: { cardId: string; stepIds: readonly string[] }) =>
      orderSteps(client, variables),
    onSettled: invalidate,
  });
}

export function useSaveComment() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (variables: { entryId: string; cardId: string | null; body: string }) =>
      saveComment(client, variables),
    onSettled: invalidate,
  });
}

export function useDeleteComment() {
  const client = useSupabase();
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: (entryId: string) => deleteComment(client, entryId),
    onSettled: invalidate,
  });
}
