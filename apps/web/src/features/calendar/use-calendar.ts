'use client';

import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { fetchProperties, fetchStaff, fetchTasksBetween } from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';
import type { CalendarTask } from '@/features/tasks/schema';
import { useSupabase, type Client } from '@/lib/supabase/use-client';

import { fetchCalendarBookings } from './api';
import { mergeById } from './bars';
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

/** A layer read month by month: all of the window's months, or none of them. */
export interface MonthLayer<T> {
  data: T[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

export type BookingsLayer = MonthLayer<CalendarBooking>;
export type TasksLayer = MonthLayer<CalendarTask>;

/** The query of one month of a layer. */
type MonthQuery<T> = (
  client: Client | null,
  isStand: boolean,
  month: string,
) => { queryKey: readonly unknown[]; queryFn: () => Promise<T[]>; enabled: boolean };

/**
 * One month of bookings. Keyed by the calendar month, outside `tasks`: the
 * arrows reuse what they have read, and saving a task does not reread
 * bookings (docs/f10-plan.md, §1).
 */
const bookingsQuery: MonthQuery<CalendarBooking> = (client, isStand, month) => ({
  queryKey: isStand ? ['calendar', 'stand', 'bookings', month] : ['calendar', 'bookings', month],
  queryFn: () => {
    const { from, to } = monthBounds(month);
    return fetchCalendarBookings(client as Client, from, to);
  },
  enabled: client !== null,
});

/**
 * One month of the live and done tasks. Under `taskKeys.all`, so the form,
 * the drawer and a cancel — which invalidate `['tasks']` — wake the calendar
 * without wiring of their own (§1).
 */
const tasksQuery: MonthQuery<CalendarTask> = (client, isStand, month) => ({
  queryKey: isStand
    ? ['calendar', 'stand', 'tasks', 'active', month]
    : taskKeys.calendar('active', month),
  queryFn: () => {
    const { from, to } = monthBounds(month);
    return fetchTasksBetween(client as Client, from, to, 'active');
  },
  enabled: client !== null,
});

// Defined once, so the combined answer is kept until a month changes.
function combineMonths<T extends { id: string | number }>(
  results: UseQueryResult<T[]>[],
): MonthLayer<T> {
  const failed = results.find((result) => result.isError);
  if (failed !== undefined) {
    // Half a window would read as free nights, or as days with nothing to do (§1).
    return { data: undefined, isPending: false, isError: true, error: failed.error };
  }
  if (results.some((result) => result.data === undefined)) {
    return { data: undefined, isPending: true, isError: false, error: null };
  }
  return {
    data: mergeById(results.map((result) => result.data ?? [])),
    isPending: false,
    isError: false,
    error: null,
  };
}

/**
 * A layer of the window's days, read month by month. The month on either
 * side is read ahead, because the next arrow lands there.
 */
function useMonthLayer<T extends { id: string | number }>(
  query: MonthQuery<T>,
  client: Client | null,
  isStand: boolean,
  days: readonly string[],
): MonthLayer<T> {
  const queryClient = useQueryClient();
  const months = monthsOf(days);
  const ahead = neighbourMonths(months).join(' ');

  const layer = useQueries({
    queries: months.map((month) => query(client, isStand, month)),
    combine: combineMonths<T>,
  });

  useEffect(() => {
    if (client === null || ahead === '') {
      return;
    }
    for (const month of ahead.split(' ')) {
      void queryClient.prefetchQuery(query(client, isStand, month));
    }
  }, [queryClient, query, client, isStand, ahead]);

  return layer;
}

/** The live bookings of the window's days (7.3). */
export function useCalendarBookings(
  client: Client | null,
  isStand: boolean,
  days: readonly string[],
): BookingsLayer {
  return useMonthLayer(bookingsQuery, client, isStand, days);
}

/** The live and done tasks of the window's days (7.4). */
export function useCalendarTasks(
  client: Client | null,
  isStand: boolean,
  days: readonly string[],
): TasksLayer {
  return useMonthLayer(tasksQuery, client, isStand, days);
}

/**
 * The working staff for the assignee filter: the same read and the same
 * cache as the task form's executor field.
 */
export function useCalendarStaff(client: Client | null, isStand: boolean) {
  return useQuery({
    queryKey: isStand ? ['calendar', 'stand', 'staff'] : taskKeys.staff(),
    queryFn: () => fetchStaff(client as Client),
    enabled: client !== null,
  });
}
