'use client';

import type { BoardColumn } from '@str-ops/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

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

/** What a write leaves stale: the list of boards, a board's cards, the card open. */
type Stale = 'boards' | 'cards' | 'card';

const STALE_KEY: Readonly<Record<Stale, readonly string[]>> = {
  boards: boardKeys.list(),
  cards: ['boards', 'cards'],
  card: ['boards', 'card'],
};

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

export function useSaveCard() {
  const client = useSupabase();
  const invalidate = useInvalidate('cards', 'card');
  return useMutation({
    mutationFn: (variables: SaveCardVariables) => saveCard(client, variables),
    onSettled: invalidate,
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
 * A move shows at once — on the board and on the card open — while the server
 * is asked, and goes back if it refuses.
 */
export function useMoveCard(boardId: string) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate('cards', 'card');
  return useMutation({
    mutationFn: (variables: { cardId: string; column: BoardColumn }) => moveCard(client, variables),
    onMutate: async ({ cardId, column }) => {
      const kept = [
        await keep(queryClient, boardKeys.cards(boardId)),
        await keep(queryClient, boardKeys.card(cardId)),
      ];
      queryClient.setQueryData<BoardCard[]>(boardKeys.cards(boardId), (cards) =>
        cards?.map((card) => (card.id === cardId ? { ...card, column_key: column } : card)),
      );
      queryClient.setQueryData<CardDetail | null>(boardKeys.card(cardId), (card) =>
        card === undefined || card === null ? card : { ...card, column_key: column },
      );
      return kept;
    },
    onError: (_error, _variables, kept) => putBack(queryClient, kept),
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
