'use client';

import { useEffect, useState } from 'react';

/**
 * The time, read again every `intervalMs`. The dashboard judges its figures
 * at this instant: a page left open overnight moves on to the new day, and a
 * repair falls overdue at its listing's midnight, with no read of its own.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
