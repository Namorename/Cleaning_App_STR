import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

/**
 * What the review of the panel asked to be proven: a bare «Задания» is still
 * the technicians' board, a card's links open safely, and a move refused by
 * the server goes back on the board and on the card.
 */

const search = { value: '' };
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock('@/features/problems/problems-view', () => ({ ProblemsView: () => <p>tech board</p> }));
vi.mock('../board-switcher', () => ({ BoardSwitcher: () => <nav aria-label="switcher" /> }));
vi.mock('../manager-board-view', () => ({
  ManagerBoardView: ({ boardId }: { boardId: string }) => <p>manager board {boardId}</p>,
}));

const moveCard = vi.fn();
const orderColumns = vi.fn();
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  moveCard: (...args: unknown[]) => moveCard(...args),
  orderColumns: (...args: unknown[]) => orderColumns(...args),
}));
vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

import { boardKeys } from '../keys';
import { LinkedText } from '../linked-text';
import { ProblemsSection } from '../problems-section';
import { useMoveCard, useOrderColumns } from '../use-boards';

const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
const CARD = 'b0a2d200-0000-4000-8000-000000000001';

describe('«Задания»', () => {
  test("a bare address is the technicians' board, as it always was", () => {
    search.value = '';
    render(<ProblemsSection viewer={{ id: 'u', isAdmin: false }} />);
    expect(screen.getByText('tech board')).toBeInTheDocument();
    expect(screen.queryByText(/manager board/)).not.toBeInTheDocument();
  });

  test('its own parameters stay its own', () => {
    search.value = 'view=archive&q=кран';
    render(<ProblemsSection viewer={{ id: 'u', isAdmin: false }} />);
    expect(screen.getByText('tech board')).toBeInTheDocument();
  });

  test('a board in the address is that manager board', () => {
    search.value = `board=${BOARD}`;
    render(<ProblemsSection viewer={{ id: 'u', isAdmin: false }} />);
    expect(screen.getByText(`manager board ${BOARD}`)).toBeInTheDocument();
  });

  // The reception has no manager boards (owner, 2026-11-19).
  test.each(['', `board=${BOARD}`, 'board=mine'])(
    "without boards, %j is the technicians' board, with no switcher",
    (address) => {
      search.value = address;
      render(<ProblemsSection viewer={{ id: 'u', isAdmin: false }} hasBoards={false} />);
      expect(screen.getByText('tech board')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'switcher' })).not.toBeInTheDocument();
      expect(screen.queryByText(/manager board/)).not.toBeInTheDocument();
    },
  );
});

test('a link in a card opens in a new tab without handing it this page', () => {
  render(<LinkedText text="See https://example.com/a_(b) now" />);
  const link = screen.getByRole('link', { name: 'https://example.com/a_(b)' });
  expect(link).toHaveAttribute('href', 'https://example.com/a_(b)');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

describe('a move', () => {
  const OPEN = 'c0a2d300-0000-4000-8000-000000000001';
  const DONE = 'c0a2d300-0000-4000-8000-000000000004';

  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const card = { id: CARD, column_id: OPEN, column_key: 'open' };
    client.setQueryData(boardKeys.cards(BOARD), [card]);
    client.setQueryData(boardKeys.card(CARD), { ...card, steps: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useMoveCard(boardKeys.cards(BOARD)), { wrapper });
    type Place = { column_id: string; column_key: string };
    const placeOf = ({ column_id, column_key }: Place) => ({ column_id, column_key });
    const column = () => ({
      board: placeOf((client.getQueryData(boardKeys.cards(BOARD)) as Place[])[0]),
      card: placeOf(client.getQueryData(boardKeys.card(CARD)) as Place),
    });
    return { hook, column };
  }

  test('shows at once on the board and on the card open: the column and its stage', async () => {
    let answer: () => void = () => undefined;
    moveCard.mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)));
    const { hook, column } = setup();
    act(() => hook.result.current.mutate({ cardId: CARD, columnId: DONE, stage: 'resolved' }));
    const moved = { column_id: DONE, column_key: 'resolved' };
    await waitFor(() => expect(column()).toEqual({ board: moved, card: moved }));
    await act(async () => answer());
  });

  test('a move by a stage alone («Назначено мне») shows the stage, the column as it was', async () => {
    let answer: () => void = () => undefined;
    moveCard.mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)));
    const { hook, column } = setup();
    act(() => hook.result.current.mutate({ cardId: CARD, stage: 'resolved' }));
    const moved = { column_id: OPEN, column_key: 'resolved' };
    await waitFor(() => expect(column()).toEqual({ board: moved, card: moved }));
    await act(async () => answer());
  });

  test('a refused move goes back on both', async () => {
    moveCard.mockRejectedValueOnce({ message: 'no', hint: 'serverErrors.boardNotYours' });
    const { hook, column } = setup();
    act(() => hook.result.current.mutate({ cardId: CARD, columnId: DONE, stage: 'resolved' }));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    const back = { column_id: OPEN, column_key: 'open' };
    expect(column()).toEqual({ board: back, card: back });
  });
});

describe('an order of the columns', () => {
  const A = 'c0a2d300-0000-4000-8000-00000000000a';
  const B = 'c0a2d300-0000-4000-8000-00000000000b';

  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(boardKeys.columns(BOARD), [
      { id: A, board_id: BOARD, position: 1 },
      { id: B, board_id: BOARD, position: 2 },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useOrderColumns(), { wrapper });
    const positions = () =>
      (client.getQueryData(boardKeys.columns(BOARD)) as { id: string; position: number }[]).map(
        ({ id, position }) => [id, position],
      );
    return { hook, positions };
  }

  test('shows at once', async () => {
    let answer: () => void = () => undefined;
    orderColumns.mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)));
    const { hook, positions } = setup();
    act(() => hook.result.current.mutate({ boardId: BOARD, columnIds: [B, A] }));
    await waitFor(() =>
      expect(positions()).toEqual([
        [A, 2],
        [B, 1],
      ]),
    );
    await act(async () => answer());
  });

  test('a refused order goes back', async () => {
    orderColumns.mockRejectedValueOnce({ message: 'no', hint: 'serverErrors.boardNotYours' });
    const { hook, positions } = setup();
    act(() => hook.result.current.mutate({ boardId: BOARD, columnIds: [B, A] }));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(positions()).toEqual([
      [A, 1],
      [B, 2],
    ]);
  });
});
