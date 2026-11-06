/**
 * The codes of public.issue_themes for the reading of past reviews. The list
 * lives in packages/shared/src/quality too, which a Deno function cannot import;
 * apps/web/src/lib/__tests__/quality.test.ts holds the copies together.
 */

export const ISSUE_THEMES = [
  "heating",
  "hot_water",
  "air_conditioning",
  "plumbing",
  "drain_toilet",
  "shower_bath",
  "electric_light",
  "wifi",
  "tv",
  "kettle",
  "kitchen_appliance",
  "laundry_appliance",
  "appliance_other",
  "checkin_access",
  "lock_door",
  "lift_stairs",
  "parking",
  "cleanliness",
  "smell",
  "pests",
  "mould_damp",
  "bed_comfort",
  "linen_towels",
  "furniture",
  "window_blind",
  "room_temperature",
  "supplies_amenities",
  "noise_outside",
  "noise_neighbours",
  "location",
  "accuracy",
  "communication",
  "value",
  "safety",
  "other",
] as const;
export type IssueTheme = (typeof ISSUE_THEMES)[number];
