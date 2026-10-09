import { act, renderHook } from '@testing-library/react-native';

import { useOverdue } from '../use-overdue';

/** A wait the screen does not hold for ever (the fourth pass on video, finding 4). */

const LIMIT_MS = 30_000;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function pass(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

test('a wait is overdue at its limit, not before', async () => {
  const { result } = await renderHook(() => useOverdue(true, LIMIT_MS));

  await pass(LIMIT_MS - 1);
  const isEarly = result.current.isOverdue;
  await pass(1);

  expect(isEarly).toBe(false);
  expect(result.current.isOverdue).toBe(true);
});

test('nothing waited on is never overdue', async () => {
  const { result } = await renderHook(() => useOverdue(false, LIMIT_MS));

  await pass(2 * LIMIT_MS);

  expect(result.current.isOverdue).toBe(false);
});

test('started again, the wait counts its limit anew', async () => {
  const { result } = await renderHook(() => useOverdue(true, LIMIT_MS));
  await pass(LIMIT_MS);

  await act(async () => {
    result.current.restart();
  });
  await pass(LIMIT_MS - 1);
  const isEarly = result.current.isOverdue;
  await pass(1);

  expect(isEarly).toBe(false);
  expect(result.current.isOverdue).toBe(true);
});

test('a wait that ends and begins again is a new one', async () => {
  // Arrange: overdue once.
  const { result, rerender } = await renderHook(
    ({ isWaiting }: { isWaiting: boolean }) => useOverdue(isWaiting, LIMIT_MS),
    { initialProps: { isWaiting: true } },
  );
  await pass(LIMIT_MS);

  // Act: what was waited for came, then a new wait began.
  await rerender({ isWaiting: false });
  await rerender({ isWaiting: true });

  // Assert
  expect(result.current.isOverdue).toBe(false);
  await pass(LIMIT_MS);
  expect(result.current.isOverdue).toBe(true);
});
