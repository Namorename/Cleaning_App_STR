'use client';

import { useQuery } from '@tanstack/react-query';

import { useCalendarRows, useLiveRepairs } from '@/features/calendar/use-calendar';
import { useProblems } from '@/features/problems/use-problems';
import { useSupplyRequests } from '@/features/supplies/use-supplies';
import { fetchTasksBetween } from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';
import { useSupabase } from '@/lib/supabase/use-client';

import { dashboardWindow, REFRESH_MS } from './counts';

/**
 * What the tiles count, with no reader of its own (docs/dashboard-plan.md).
 * The problems, the supply requests and the live repairs are read as their
 * sections and the calendar read them, under the same keys: a tile's link
 * opens on what is already held, and a write there wakes the tiles. The tasks
 * are the week's alone — the section reads a month back — keyed under
 * `taskKeys.all`, so a saved or cancelled task wakes them too.
 */
export function useDashboard(now: Date) {
  const client = useSupabase();
  const { from, to } = dashboardWindow(now);

  const tasks = useQuery({
    queryKey: taskKeys.dashboard(from, to),
    queryFn: () => fetchTasksBetween(client, from, to, 'active'),
    refetchInterval: REFRESH_MS,
  });
  const problems = useProblems(REFRESH_MS);
  const supplies = useSupplyRequests(REFRESH_MS);
  const repairs = useLiveRepairs(client, false, REFRESH_MS);
  // The calendar's rows, its read and key: «Без исполнителя» counts only what
  // the calendar it leads to can draw. Listings seldom change; no interval.
  const rows = useCalendarRows(client, false);

  return { tasks, problems, supplies, repairs, rows };
}
