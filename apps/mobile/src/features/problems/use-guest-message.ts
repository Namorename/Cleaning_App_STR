import {
  GUEST_MESSAGE_FUNCTION,
  guestMessageBody,
  guestMessageFailure,
  readGuestMessages,
  type GuestMessage,
  type GuestMessageFailure,
} from '@str-ops/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** A refusal of guest-message-text, by the state it names (problems.guestMessage.*). */
export class GuestMessageRefusal extends Error {
  override readonly name = 'GuestMessageRefusal';
  constructor(readonly failure: GuestMessageFailure) {
    super(`guest-message-text refused: ${failure}`);
  }
}

/** The i18n key of the function's refusal, read from the answer's body; none for a network failure. */
async function refusalHint(error: unknown): Promise<string | undefined> {
  const context = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (typeof context?.json !== 'function') {
    return undefined;
  }
  try {
    const body = await context.json();
    const hint = (body as { error?: { hint?: unknown } } | null)?.error?.hint;
    return typeof hint === 'string' ? hint : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The guest's message of a chat task as Hostaway has it now (guest-message-text,
 * docs/guest-message-text.md). The phone sends no Origin; the function checks the token, the role
 * and the company, and answers the head technician and the office alone.
 */
export async function fetchGuestMessage(problemId: string): Promise<readonly GuestMessage[]> {
  const { data, error } = await supabase.functions.invoke(GUEST_MESSAGE_FUNCTION, {
    body: guestMessageBody({ problemId }),
  });
  if (error) {
    throw new GuestMessageRefusal(guestMessageFailure(await refusalHint(error)));
  }
  const messages = readGuestMessages((data as { data?: unknown } | null)?.data);
  if (messages === null) {
    throw new GuestMessageRefusal('failed');
  }
  return messages;
}

export type GuestMessageRead =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'shown'; readonly messages: readonly GuestMessage[] }
  | { readonly phase: 'failed'; readonly failure: GuestMessageFailure };

const IDLE: GuestMessageRead = { phase: 'idle' };

/**
 * The read, on the reader's press. Not a query on purpose: the phone keeps its queries on disk
 * (lib/query-client.ts), and a guest's words are not ours to keep anywhere — they live in this
 * screen's state and go with it. An answer that comes back after the screen closed, or after a
 * newer press, is dropped.
 */
export function useGuestMessage(problemId: string): {
  read: GuestMessageRead;
  ask: () => void;
} {
  // The read remembers its task: another task on the same screen starts from «idle» at once.
  const [state, setState] = useState<{ readonly problemId: string; readonly read: GuestMessageRead }>(
    { problemId, read: IDLE },
  );
  const latest = useRef(0);

  // Another task, or the screen gone: a read still in flight is dropped when it answers.
  useEffect(
    () => () => {
      latest.current += 1;
    },
    [problemId],
  );

  const ask = useCallback(() => {
    latest.current += 1;
    const asked = latest.current;
    setState({ problemId, read: { phase: 'loading' } });
    fetchGuestMessage(problemId).then(
      (messages) => {
        if (latest.current === asked) {
          setState({ problemId, read: { phase: 'shown', messages } });
        }
      },
      (error: unknown) => {
        if (latest.current === asked) {
          const failure = error instanceof GuestMessageRefusal ? error.failure : 'failed';
          setState({ problemId, read: { phase: 'failed', failure } });
        }
      },
    );
  }, [problemId]);

  return { read: state.problemId === problemId ? state.read : IDLE, ask };
}
