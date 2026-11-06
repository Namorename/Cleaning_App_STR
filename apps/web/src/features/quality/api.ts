import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, QualityWindow } from '@str-ops/shared';
import type { z } from 'zod';

import {
  overviewSchema,
  placeCardSchema,
  type QualityOverview,
  type QualityPlaceCard,
} from './schema';

type Client = SupabaseClient<Database>;

/**
 * What a reader may pass to the manager (CLAUDE.md: the server's words stand small
 * under the screen's): zod's own message is a dump of every path it refused.
 */
const UNEXPECTED_SHAPE = 'The answer has an unexpected shape';

function checked<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(UNEXPECTED_SHAPE, { cause: parsed.error });
  }
  return parsed.data;
}

/** The portfolio of one window: every place and every theme with something to say. */
export async function fetchQualityOverview(
  client: Client,
  window: QualityWindow,
): Promise<QualityOverview> {
  const { data, error } = await client.rpc('quality_overview', { p_window: window });
  if (error) {
    throw error;
  }
  return checked(overviewSchema, data);
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
  return data === null ? null : checked(placeCardSchema, data);
}
