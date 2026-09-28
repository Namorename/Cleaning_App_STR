import { useEffect } from 'react';

import { showingThread } from './open-thread';

/**
 * Tells the foreground handler which thread is on her screen: pass the
 * thread's id while the chat screen is focused, null otherwise. A push about
 * that thread then arrives without a banner or a sound — its message is
 * already in front of her.
 */
export function useShowingThread(threadId: string | null): void {
  useEffect(() => (threadId === null ? undefined : showingThread(threadId)), [threadId]);
}
