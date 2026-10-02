import type { PushData } from './payload';

/**
 * The chat thread on her screen right now, if any.
 *
 * Module state rather than React state: the foreground handler reads it
 * outside any component and must answer at once — on SDK 57 a handler that
 * takes longer than three seconds loses the notification.
 */
let shownThreadId: string | null = null;

/**
 * The chat screen is showing this thread. Returns the way to say it no longer
 * is — which does nothing if another thread has been opened since, so a
 * screen leaving late cannot unsilence the one in front of her.
 */
export function showingThread(threadId: string): () => void {
  shownThreadId = threadId;
  return () => {
    if (shownThreadId === threadId) {
      shownThreadId = null;
    }
  };
}

/** The thread on her screen, or null. */
export function shownThread(): string | null {
  return shownThreadId;
}

/** A message in the thread she is reading: already on her screen. */
export function isShownThread(data: PushData | null): boolean {
  return (
    data !== null &&
    data.kind === 'chat_message' &&
    data.threadId !== undefined &&
    data.threadId === shownThreadId
  );
}
