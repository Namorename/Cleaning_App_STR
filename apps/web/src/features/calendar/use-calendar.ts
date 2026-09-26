'use client';

import {
  queryOptions,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { fetchProperties } from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';
import { useSupabase, type Client } from '@/lib/supabase/use-client';

import { fetchCalendarBookings } from './api';
import { mergeBookings } from './bars';
import { monthBounds, monthsOf, neighbourMonths } from './dates';
import type { CalendarBooking } from './schema';

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

/**
 * One month of bookings. Keyed by the calendar month, outside `tasks`: the
 * arrows reuse what they have read, and saving a task does not reread
 * bookings (docs/f10-plan.md, §1).
 */
function bookingsQuery(client: Client | null, isStand: boolean, month: string) {
  return queryOptions({
    queryKey: isStand ? ['calendar', 'stand', 'bookings', month] : ['calendar', 'bookings', month],
    queryFn: () => {
      const { from, to } = monthBounds(month);
      return fetchCalendarBookings(client as Client, from, to);
    },
    enabled: client !== null,
  });
}

/** The bookings layer: all of the window's months, or none of them. */
export interface BookingsLayer {
  data: CalendarBooking[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

// Defined once, so the combined answer is kept until a month changes.
function combineMonths(results: UseQueryResult<CalendarBooking[]>[]): BookingsLayer {
  const failed = results.find((result) => result.isError);
  if (failed !== undefined) {
    // Half the stays of a window would read as free nights (§1).
    return { data: undefined, isPending: false, isError: true, error: failed.error };
  }
  if (results.some((result) => result.data === undefined)) {
    return { data: undefined, isPending: true, isError: false, error: null };
  }
  return {
    data: mergeBookings(results.map((result) => result.data ?? [])),
    isPending: false,
    isError: false,
    error: null,
  };
}

/**
 * The live bookings of the window's days, read month by month. The month on
 * either side is read ahead, because the next arrow lands there.
 */
export function useCalendarBookings(
  client: Client | null,
  isStand: boolean,
  days: readonly string[],
): BookingsLayer {
  const queryClient = useQueryClient();
  const months = monthsOf(days);
  const ahead = neighbourMonths(months).join(' ');

  const layer = useQueries({
    queries: months.map((month) => bookingsQuery(client, isStand, month)),
    combine: combineMonths,
  });

  useEffect(() => {
    if (client === null || ahead === '') {
      return;
    }
    for (const month of ahead.split(' ')) {
      void queryClient.prefetchQuery(bookingsQuery(client, isStand, month));
    }
  }, [queryClient, client, isStand, ahead]);

  return layer;
}
