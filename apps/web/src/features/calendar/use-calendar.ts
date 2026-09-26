'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { fetchProperties } from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';
import { useSupabase, type Client } from '@/lib/supabase/use-client';

/**
 * The client the calendar reads through.
 *
 * On the stand (`CALENDAR_FIXTURE=1`, docs/f10-plan.md §5) it is a stub over a
 * fixture, loaded by a dynamic import only then: the chunk is in every build,
 * Vercel's included, but nothing asks for it there. Null while it loads.
 */
export function useCalendarClient(isStand: boolean): Client | null {
  const real = useSupabase();
  const [stand, setStand] = useState<Client | null>(null);

  useEffect(() => {
    if (!isStand) {
      return;
    }
    let isLive = true;
    void import('./stand').then((module) => {
      if (isLive) {
        setStand(module.standClient());
      }
    });
    return () => {
      isLive = false;
    };
  }, [isStand]);

  return isStand ? stand : real;
}

/**
 * The rows: every listing and room that is not archived, the same read and
 * the same cache as the task form's listing field (§1).
 */
export function useCalendarRows(client: Client | null, isStand: boolean) {
  return useQuery({
    queryKey: isStand ? ['calendar', 'stand', 'properties'] : taskKeys.properties(),
    queryFn: () => fetchProperties(client as Client),
    enabled: client !== null,
  });
}
