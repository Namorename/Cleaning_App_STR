'use client';

import type { QualityWindow } from '@str-ops/shared';
import { useQuery } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import { fetchQualityAreas, fetchQualityOverview, fetchQualityPlace } from './api';
import { qualityKeys } from './keys';

/**
 * The episodes change once a night. Five minutes keeps a manager's
 * back-and-forth between windows off the server. A window's numbers are not
 * kept on the screen while the next loads: under the wrong pill they would lie.
 */
const STALE_MS = 5 * 60 * 1000;

export function useQualityOverview(window: QualityWindow) {
  const client = useSupabase();
  return useQuery({
    queryKey: qualityKeys.overview(window),
    queryFn: () => fetchQualityOverview(client, window),
    staleTime: STALE_MS,
  });
}

export function useQualityAreas(window: QualityWindow) {
  const client = useSupabase();
  return useQuery({
    queryKey: qualityKeys.areas(window),
    queryFn: () => fetchQualityAreas(client, window),
    staleTime: STALE_MS,
  });
}

export function useQualityPlace(placeId: number, window: QualityWindow) {
  const client = useSupabase();
  return useQuery({
    queryKey: qualityKeys.place(placeId, window),
    queryFn: () => fetchQualityPlace(client, placeId, window),
    staleTime: STALE_MS,
  });
}
