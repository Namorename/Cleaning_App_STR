import type { QualityTheme } from './index';

/**
 * Plans of resolution (docs/property-intelligence-plan.md §5): the kinds of a step, who may hold
 * each, and what a draft proposes for a theme. A proposal is a template: it costs nothing, it can
 * be read in advance, and nothing happens until a manager launches it.
 */

export const PLAN_STEP_KINDS = ['repair', 'inspection', 'purchase', 'decision'] as const;
export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number];

/** launch_resolution_plan refuses anyone else; the two lists must say the same. */
export const PLAN_STEP_ROLES: Readonly<Record<PlanStepKind, readonly string[]>> = {
  repair: ['tech', 'head_tech'],
  inspection: ['cleaner', 'manager', 'admin'],
  purchase: ['manager', 'admin'],
  decision: ['manager', 'admin'],
};

const FIX_THEN_CHECK: readonly PlanStepKind[] = ['repair', 'inspection'];
const DECIDE: readonly PlanStepKind[] = ['decision'];
const BUY: readonly PlanStepKind[] = ['purchase'];

/** What a draft starts with for a theme; the manager changes all of it. */
export const THEME_STEP_KINDS: Readonly<Record<QualityTheme, readonly PlanStepKind[]>> = {
  heating: FIX_THEN_CHECK,
  hot_water: FIX_THEN_CHECK,
  air_conditioning: FIX_THEN_CHECK,
  plumbing: FIX_THEN_CHECK,
  drain_toilet: FIX_THEN_CHECK,
  shower_bath: FIX_THEN_CHECK,
  electric_light: FIX_THEN_CHECK,
  wifi: FIX_THEN_CHECK,
  tv: FIX_THEN_CHECK,
  kettle: BUY,
  kitchen_appliance: FIX_THEN_CHECK,
  laundry_appliance: FIX_THEN_CHECK,
  appliance_other: FIX_THEN_CHECK,
  checkin_access: DECIDE,
  lock_door: FIX_THEN_CHECK,
  lift_stairs: DECIDE,
  parking: DECIDE,
  cleanliness: ['inspection', 'decision'],
  smell: ['inspection', 'decision'],
  pests: FIX_THEN_CHECK,
  mould_damp: FIX_THEN_CHECK,
  bed_comfort: ['purchase', 'inspection'],
  linen_towels: BUY,
  furniture: ['repair', 'purchase'],
  window_blind: FIX_THEN_CHECK,
  room_temperature: ['inspection', 'decision'],
  supplies_amenities: BUY,
  noise_outside: DECIDE,
  noise_neighbours: DECIDE,
  location: DECIDE,
  accuracy: DECIDE,
  communication: DECIDE,
  value: DECIDE,
  safety: FIX_THEN_CHECK,
  other: DECIDE,
};
