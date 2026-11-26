import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { withClient } from '@/testing/restored-cache';

import { moveCard } from '../api';
import { boardKeys, useMoveCard } from '../use-boards';

/**
 * A card moved on the phone (20261126120000): the board's list shows it in its new column at once —
 * its column by id, and the stage the server keeps its key as, the target column's — and goes back
 * to what it was when the server refuses. The write itself names the column by id.
 */

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: 'aaaaaaaa-0000-4000-8000-000000000001', session: null }),
}));
jest.mock('../api', () => ({ moveCard: jest.fn() }));

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
const OPEN = 'c01a2b3c-0000-4000-8000-000000000001';
const DONE = 'c01a2b3c-0000-4000-8000-000000000006';
const move = jest.mocked(moveCard);

const card = (id: string) => ({ id, board_id: BOARD, column_id: OPEN, column_key: 'open' });
const BEFORE = [card('c1'), card('c2')];

async function moveFirstToDone(client: QueryClient) {
  const { result } = await renderHook(() => useMoveCard(BOARD), { wrapper: withClient(client) });
  await act(async () => {
    result.current.mutate({ cardId: 'c1', column: { id: DONE, legacy_key: 'resolved' } });
  });
  return result;
}

function boardList(): { client: QueryClient; key: readonly unknown[] } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = boardKeys.cards(ME, BOARD);
  client.setQueryData(key, BEFORE);
  return { client, key };
}

beforeEach(() => {
  move.mockReset();
});

test('shows at once in the column moved to, with that column’s stage, and sends its id', async () => {
  // Arrange: the server answers only when told to.
  let answer: () => void = () => undefined;
  move.mockReturnValue(
    new Promise<void>((resolve) => {
      answer = resolve;
    }),
  );
  const { client, key } = boardList();

  // Act
  const result = await moveFirstToDone(client);

  // Assert: before the answer.
  await waitFor(() =>
    expect(client.getQueryData(key)).toEqual([
      { ...card('c1'), column_id: DONE, column_key: 'resolved' },
      card('c2'),
    ]),
  );
  expect(move).toHaveBeenCalledWith({ cardId: 'c1', columnId: DONE });
  await act(async () => answer());
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});

test('a refusal puts the list back as it was', async () => {
  // Arrange
  move.mockRejectedValue({ message: 'Column not found', hint: 'serverErrors.boardColumnNotFound' });
  const { client, key } = boardList();

  // Act
  const result = await moveFirstToDone(client);

  // Assert
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(client.getQueryData(key)).toEqual(BEFORE);
});
