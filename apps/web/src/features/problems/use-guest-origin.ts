'use client';

import { readGuestOrigin, type Database, type GuestOrigin } from '@str-ops/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import { problemKeys } from './keys';

type Client = SupabaseClient<Database>;

/**
 * Where a task from a guest came from, as this manager may know it (problem_guest_origin,
 * 20261111120000): the stay, the guest's name read from the booking now, the channel, the rating,
 * the day sent, the PMS's numbers. Null for a report of the staff. Nothing of it is stored: the
 * panel keeps it in memory for the page, as it keeps every read.
 */
export async function fetchGuestOrigin(
  client: Client,
  problemId: string,
): Promise<GuestOrigin | null> {
  const { data, error } = await client.rpc('problem_guest_origin', { p_problem_id: problemId });
  if (error) {
    throw error;
  }
  return readGuestOrigin(data);
}

/** The guest's name stays fresh: a page left open does not show a name retention has cleared. */
const ORIGIN_FRESH_FOR_MS = 60 * 1000;

/** Read only for a task from a guest; one more try, as a page's other reads. */
export function useGuestOrigin(problemId: string, isFromGuest: boolean) {
  const client = useSupabase();
  return useQuery({
    queryKey: problemKeys.origin(problemId),
    queryFn: () => fetchGuestOrigin(client, problemId),
    enabled: isFromGuest,
    staleTime: ORIGIN_FRESH_FOR_MS,
    retry: 1,
  });
}
