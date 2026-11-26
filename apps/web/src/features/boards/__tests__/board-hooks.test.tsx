import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The boards' hooks themselves (20261126120000), over a real query cache with the server's calls
 * stubbed: what each write marks stale, what shows at once and goes back on a refusal, and how
 * «Назначено мне» reads its boards' columns and moves a card into one.
 */

const api = vi.hoisted(() => ({
  transferBoard: vi.fn(),
  saveColumn: vi.fn(),
  deleteColumn: vi.fn(),
  setColumnDone: vi.fn(),
  moveCard: vi.fn(),
  saveCard: vi.fn(),
  fetchBoardColumns: vi.fn(),
}));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  ...api,
}));
vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

import { boardKeys } from '../keys';
import {
  useBoardColumnsOf,
  useDeleteColumn,
  useForgetBoard,
  useMoveCard,
  useSaveCard,
  useSaveColumn,
  useSetColumnDone,
  useTransferBoard,
} from '../use-boards';

const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
const OTHER = 'b0a2d100-0000-4000-8000-000000000002';
const CARD = 'b0a2d200-0000-4000-8000-000000000001';
const VIEWER = 'aaaaaaaa-0000-4000-8000-000000000002';
const OPEN = 'c0a2d300-0000-4000-8000-000000000001';
const DONE = 'c0a2d300-0000-4000-8000-000000000004';
const REFUSAL = { message: 'no', hint: 'serverErrors.boardNotYours' };

const LIST = ['boards', 'list'];
const CARDS = ['boards', 'cards'];
const ONE_CARD = ['boards', 'card'];
const COLUMNS = ['boards', 'columns'];

/** A hook over a fresh cache, with every key it marks stale recorded. */
function setup<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(hook, { wrapper });
  const stale = () =>
    invalidate.mock.calls
      .map(([filters]) => JSON.stringify(filters?.queryKey))
      .sort()
      .map((key) => JSON.parse(key) as string[]);
  return { client, result, stale };
}

/** The keys, in the order `stale()` sorts them. */
const sorted = (...keys: string[][]) =>
  keys
    .map((key) => JSON.stringify(key))
    .sort()
    .map((key) => JSON.parse(key) as string[]);

/** A server's answer that waits for the test. */
function pending() {
  let answer: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => (answer = resolve));
  return { promise, answer: () => answer() };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const call of Object.values(api)) {
    call.mockResolvedValue(undefined);
  }
  api.fetchBoardColumns.mockResolvedValue([]);
});

describe('what a write marks stale', () => {
  test('a handover: the boards, their cards, the card open and the columns', async () => {
    const { result, stale } = setup(() => useTransferBoard());
    act(() => result.current.mutate({ boardId: BOARD, toId: VIEWER }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stale()).toEqual(sorted(LIST, CARDS, ONE_CARD, COLUMNS));
  });

  test('a rename of a column: the columns alone', async () => {
    const { result, stale } = setup(() => useSaveColumn());
    act(() => result.current.mutate({ columnId: OPEN, boardId: null, title: 'К работе' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stale()).toEqual(sorted(COLUMNS));
  });

  test('a column added: the columns and the cards, whose stages it may change', async () => {
    const { result, stale } = setup(() => useSaveColumn());
    act(() => result.current.mutate({ columnId: OPEN, boardId: BOARD, title: 'Счета' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stale()).toEqual(sorted(COLUMNS, CARDS, ONE_CARD));
  });

  test('a column deleted: the columns and the cards it moved', async () => {
    const { result, stale } = setup(() => useDeleteColumn());
    act(() => result.current.mutate({ columnId: OPEN, moveToId: DONE }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stale()).toEqual(sorted(COLUMNS, CARDS, ONE_CARD));
  });

  test('a card moved: the cards; refused, the columns too — the column may be gone', async () => {
    const first = setup(() => useMoveCard(boardKeys.cards(BOARD)));
    act(() => first.result.current.mutate({ cardId: CARD, columnId: DONE, stage: 'resolved' }));
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(first.stale()).toEqual(sorted(CARDS, ONE_CARD));

    api.moveCard.mockRejectedValueOnce({
      message: 'gone',
      hint: 'serverErrors.boardColumnNotFound',
    });
    const second = setup(() => useMoveCard(boardKeys.cards(BOARD)));
    act(() => second.result.current.mutate({ cardId: CARD, columnId: DONE, stage: 'resolved' }));
    await waitFor(() => expect(second.result.current.isError).toBe(true));
    expect(second.stale()).toEqual(sorted(CARDS, ONE_CARD, COLUMNS));
  });

  test('a card made in a column refused: the columns are read again too', async () => {
    api.saveCard.mockRejectedValueOnce({
      message: 'gone',
      hint: 'serverErrors.boardColumnNotFound',
    });
    const { result, stale } = setup(() => useSaveCard());
    act(() =>
      result.current.mutate({
        cardId: CARD,
        boardId: BOARD,
        columnId: OPEN,
        fields: { title: 'T', description: '', dueOn: null, propertyId: null, color: null },
      }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(stale()).toEqual(sorted(CARDS, ONE_CARD, COLUMNS));
  });
});

describe('«Завершающая»', () => {
  const columns = () => [
    { id: OPEN, board_id: BOARD, is_done: false },
    { id: DONE, board_id: BOARD, is_done: true },
  ];
  const doneOf = (client: QueryClient) =>
    (client.getQueryData(boardKeys.columns(BOARD)) as { id: string; is_done: boolean }[]).map(
      (column) => column.is_done,
    );

  test('shows at once, and the columns and cards are read again', async () => {
    const answer = pending();
    api.setColumnDone.mockReturnValueOnce(answer.promise);
    const { client, result, stale } = setup(() => useSetColumnDone(BOARD));
    client.setQueryData(boardKeys.columns(BOARD), columns());
    act(() => result.current.mutate({ columnId: OPEN, done: true }));
    await waitFor(() => expect(doneOf(client)).toEqual([true, true]));
    await act(async () => answer.answer());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stale()).toEqual(sorted(COLUMNS, CARDS, ONE_CARD));
  });

  test('refused, it goes back', async () => {
    api.setColumnDone.mockRejectedValueOnce(REFUSAL);
    const { client, result } = setup(() => useSetColumnDone(BOARD));
    client.setQueryData(boardKeys.columns(BOARD), columns());
    act(() => result.current.mutate({ columnId: DONE, done: false }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(doneOf(client)).toEqual([false, true]);
  });
});

describe('«Назначено мне»', () => {
  test('reads the columns of its cards’ boards at once, each board once', async () => {
    const { result } = setup(() => useBoardColumnsOf([OTHER, BOARD, OTHER]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchBoardColumns).toHaveBeenCalledTimes(1);
    expect(api.fetchBoardColumns).toHaveBeenCalledWith(expect.anything(), [BOARD, OTHER]);
  });

  test('with no card, asks for no columns', () => {
    const { result } = setup(() => useBoardColumnsOf([]));
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchBoardColumns).not.toHaveBeenCalled();
  });

  test('a card moved into its board’s column shows in it at once, and goes back if refused', async () => {
    const answer = pending();
    api.moveCard.mockReturnValueOnce(answer.promise);
    const mine = boardKeys.mine(VIEWER);
    const { client, result } = setup(() => useMoveCard(mine));
    client.setQueryData(mine, [{ id: CARD, column_id: OPEN, column_key: 'open' }]);
    const place = () =>
      (client.getQueryData(mine) as { column_id: string; column_key: string }[])[0];
    act(() => result.current.mutate({ cardId: CARD, columnId: DONE, stage: 'resolved' }));
    await waitFor(() => expect(place()).toMatchObject({ column_id: DONE, column_key: 'resolved' }));
    expect(api.moveCard).toHaveBeenCalledWith(expect.anything(), {
      cardId: CARD,
      columnId: DONE,
      stage: 'resolved',
    });
    await act(async () => answer.answer());

    api.moveCard.mockRejectedValueOnce(REFUSAL);
    client.setQueryData(mine, [{ id: CARD, column_id: OPEN, column_key: 'open' }]);
    act(() => result.current.mutate({ cardId: CARD, columnId: DONE, stage: 'resolved' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(place()).toMatchObject({ column_id: OPEN, column_key: 'open' });
  });
});

test('a board handed over out of sight is forgotten: the list, its cards and its columns', () => {
  const { client, result } = setup(() => useForgetBoard());
  client.setQueryData(boardKeys.list(), [{ id: BOARD }, { id: OTHER }]);
  client.setQueryData(boardKeys.cards(BOARD), []);
  client.setQueryData(boardKeys.columns(BOARD), []);
  client.setQueryData(boardKeys.cards(OTHER), []);
  act(() => result.current(BOARD));
  expect(client.getQueryData(boardKeys.list())).toEqual([{ id: OTHER }]);
  expect(client.getQueryData(boardKeys.cards(BOARD))).toBeUndefined();
  expect(client.getQueryData(boardKeys.columns(BOARD))).toBeUndefined();
  expect(client.getQueryData(boardKeys.cards(OTHER))).toEqual([]);
});
