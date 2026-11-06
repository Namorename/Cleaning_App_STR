import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, QualityWindow } from '@str-ops/shared';

import {
  overviewSchema,
  placeCardSchema,
  type QualityOverview,
  type QualityPlaceCard,
} from './schema';

type Client = SupabaseClient<Database>;

/** The portfolio of one window: every place and every theme with something to say. */
export async function fetchQualityOverview(
  client: Client,
  window: QualityWindow,
): Promise<QualityOverview> {
  const { data, error } = await client.rpc('quality_overview', { p_window: window });
  if (error) {
    throw error;
  }
  return overviewSchema.parse(data);
}

/** One place in one window; null when the company has no such place. */
export async function fetchQualityPlace(
  client: Client,
  placeId: number,
  window: QualityWindow,
): Promise<QualityPlaceCard | null> {
  const { data, error } = await client.rpc('quality_place', {
    p_property_id: placeId,
    p_window: window,
  });
  if (error) {
    throw error;
  }
  return data === null ? null : placeCardSchema.parse(data);
}
