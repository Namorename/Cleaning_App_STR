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
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  moveCard: (...args: unknown[]) => moveCard(...args),
}));
vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

import { boardKeys } from '../keys';
import { LinkedText } from '../linked-text';
import { ProblemsSection } from '../problems-section';
import { useMoveCard } from '../use-boards';

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
  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(boardKeys.cards(BOARD), [{ id: CARD, column_key: 'open' }]);
    client.setQueryData(boardKeys.card(CARD), { id: CARD, column_key: 'open', steps: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useMoveCard(boardKeys.cards(BOARD)), { wrapper });
    const column = () => ({
      board: (client.getQueryData(boardKeys.cards(BOARD)) as { column_key: string }[])[0]
        .column_key,
      card: (client.getQueryData(boardKeys.card(CARD)) as { column_key: string }).column_key,
    });
    return { hook, column };
  }

  test('shows at once on the board and on the card open', async () => {
    let answer: () => void = () => undefined;
    moveCard.mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)));
    const { hook, column } = setup();
    act(() => hook.result.current.mutate({ cardId: CARD, column: 'resolved' }));
    await waitFor(() => expect(column()).toEqual({ board: 'resolved', card: 'resolved' }));
    await act(async () => answer());
  });

  test('a refused move goes back on both', async () => {
    moveCard.mockRejectedValueOnce({ message: 'no', hint: 'serverErrors.boardNotYours' });
    const { hook, column } = setup();
    act(() => hook.result.current.mutate({ cardId: CARD, column: 'resolved' }));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(column()).toEqual({ board: 'open', card: 'open' });
  });
});
