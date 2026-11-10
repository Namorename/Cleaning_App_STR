import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@str-ops/shared';

import { wireStep, type DraftStep } from './draft-model';
import {
  placePlanListSchema,
  placeWorkListSchema,
  planSchema,
  type PlacePlan,
  type PlaceWork,
  type Plan,
} from './schema';

export type Client = SupabaseClient<Database>;

/** A plan with its steps; null when it is not the company's. */
export async function fetchPlan(client: Client, planId: string): Promise<Plan | null> {
  const { data, error } = await client.rpc('resolution_plan', { p_id: planId });
  if (error) {
    throw error;
  }
  return data === null ? null : planSchema.parse(data);
}

export async function fetchPlacePlans(client: Client, placeId: number): Promise<PlacePlan[]> {
  const { data, error } = await client.rpc('property_resolution_plans', {
    p_property_id: placeId,
  });
  if (error) {
    throw error;
  }
  return placePlanListSchema.parse(data);
}

/** Live tasks of a place by theme: what a draft leans on instead of making its own. */
export async function fetchPlaceWork(client: Client, placeId: number): Promise<PlaceWork[]> {
  const { data, error } = await client.rpc('resolution_plan_place_work', {
    p_property_id: placeId,
  });
  if (error) {
    throw error;
  }
  return placeWorkListSchema.parse(data);
}

export interface SavePlanVariables {
  planId: string;
  placeId: number;
  title: string;
  steps: readonly DraftStep[];
  /** What the editor last read; null for a plan that does not exist yet. */
  rev: number | null;
}

export async function savePlan(client: Client, variables: SavePlanVariables): Promise<Plan> {
  const { data, error } = await client.rpc('save_resolution_plan', {
    p_id: variables.planId,
    p_property_id: variables.placeId,
    p_title: variables.title,
    p_steps: variables.steps.map(wireStep) as unknown as Json,
    ...(variables.rev === null ? {} : { p_rev: variables.rev }),
  });
  if (error) {
    throw error;
  }
  return planSchema.parse(data);
}

export async function launchPlan(client: Client, planId: string, rev: number): Promise<Plan> {
  const { data, error } = await client.rpc('launch_resolution_plan', { p_id: planId, p_rev: rev });
  if (error) {
    throw error;
  }
  return planSchema.parse(data);
}

export async function deletePlan(client: Client, planId: string, rev: number): Promise<void> {
  const { error } = await client.rpc('delete_resolution_plan', { p_id: planId, p_rev: rev });
  if (error) {
    throw error;
  }
}

export async function cancelPlan(client: Client, planId: string, rev: number): Promise<Plan> {
  const { data, error } = await client.rpc('cancel_resolution_plan', { p_id: planId, p_rev: rev });
  if (error) {
    throw error;
  }
  return planSchema.parse(data);
}

export async function setStepDecided(
  client: Client,
  stepId: string,
  isDecided: boolean,
): Promise<Plan> {
  const { data, error } = await client.rpc('set_resolution_step_decided', {
    p_step_id: stepId,
    p_decided: isDecided,
  });
  if (error) {
    throw error;
  }
  return planSchema.parse(data);
}
