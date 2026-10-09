import { useCallback, useEffect, useState } from 'react';

export interface Overdue {
  /** Waited longer than allowed, in this round of waiting. */
  isOverdue: boolean;
  /** Start the wait again, as «Повторить» does. */
  restart: () => void;
}

/**
 * Whether something waited on has taken longer than `ms`. A read whose
 * socket went silent would otherwise hold a screen on its spinner for ever.
 * The time counts from when the waiting began, or was started again; nothing
 * counts while nothing is waited on.
 */
export function useOverdue(isWaiting: boolean, ms: number): Overdue {
  const [round, setRound] = useState(0);
  const [overdueRound, setOverdueRound] = useState<number | null>(null);
  const [wasWaiting, setWasWaiting] = useState(isWaiting);

  // A wait that begins anew is a new round: adjusted while rendering, no effect.
  if (isWaiting !== wasWaiting) {
    setWasWaiting(isWaiting);
    if (isWaiting) {
      setRound(round + 1);
    }
  }

  useEffect(() => {
    if (!isWaiting) {
      return undefined;
    }
    const timer = setTimeout(() => setOverdueRound(round), ms);
    return () => clearTimeout(timer);
  }, [isWaiting, ms, round]);

  const restart = useCallback(() => setRound((value) => value + 1), []);

  return { isOverdue: isWaiting && overdueRound === round, restart };
}
