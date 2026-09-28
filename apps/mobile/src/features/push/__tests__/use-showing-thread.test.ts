import { renderHook } from '@testing-library/react-native';

import { shownThread } from '../open-thread';
import { useShowingThread } from '../use-showing-thread';

/**
 * The chat screen says which thread is on her screen while it is focused, so
 * a push about it arrives quietly; leaving the screen says it no longer is.
 */

const THREAD_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const OTHER_THREAD_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

test('a thread on a focused screen is the one shown', async () => {
  const { unmount } = await renderHook(() => useShowingThread(THREAD_ID));

  expect(shownThread()).toBe(THREAD_ID);
  await unmount();
  expect(shownThread()).toBeNull();
});

test('no thread yet, or a screen out of focus, shows none', async () => {
  const { rerender, unmount } = await renderHook(
    ({ threadId }: { threadId: string | null }) => useShowingThread(threadId),
    { initialProps: { threadId: THREAD_ID } },
  );

  await rerender({ threadId: null });

  expect(shownThread()).toBeNull();
  await unmount();
});

test('moving to another thread shows that one', async () => {
  const { rerender, unmount } = await renderHook(
    ({ threadId }: { threadId: string | null }) => useShowingThread(threadId),
    { initialProps: { threadId: THREAD_ID } },
  );

  await rerender({ threadId: OTHER_THREAD_ID });

  expect(shownThread()).toBe(OTHER_THREAD_ID);
  await unmount();
});
