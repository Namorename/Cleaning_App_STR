import { useEffect, useState } from 'react';

const DEFAULT_TICK_MS = 30_000;

/**
 * The current time, refreshed on a timer.
 *
 * A screen that waits on the clock — a cleaning whose window opens at ten —
 * has to wake up on its own when the moment comes, without the cleaner
 * leaving and coming back. Half a minute is close enough for a button.
 */
export function useNow(tickMs: number = DEFAULT_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);

  return now;
}
