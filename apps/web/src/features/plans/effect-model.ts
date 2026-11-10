import { ratePer100 } from '@str-ops/shared';
import { z } from 'zod';

/** Under this many stays after the close the screen says so and concludes nothing (§5.6). */
export const EFFECT_MIN_STAYS = 30;

const countsSchema = z.object({
  reviews: z.number(),
  found: z.number(),
  reported: z.number(),
});
export type EffectCounts = z.infer<typeof countsSchema>;

const effectThemeSchema = z.object({
  theme: z.string(),
  seasonal: z.boolean(),
  before: countsSchema,
  after: countsSchema,
  work_after: z.number(),
  last_year: countsSchema.extend({ stays: z.number() }).nullable(),
});
export type EffectTheme = z.infer<typeof effectThemeSchema>;

export const planEffectSchema = z
  .object({
    closed_on: z.string(),
    launched_on: z.string().nullable(),
    stays_before: z.number().nullable(),
    stays_after: z.number(),
    themes: z.array(effectThemeSchema),
  })
  .nullable();
export type PlanEffect = z.infer<typeof planEffectSchema>;

export const EFFECT_LAYERS = ['reviews', 'found', 'reported'] as const;
export type EffectLayer = (typeof EFFECT_LAYERS)[number];

export interface EffectRow {
  layer: EffectLayer;
  before: number;
  after: number;
  rateBefore: number | null;
  rateAfter: number | null;
}

/** A layer no side speaks of says nothing and takes no line. */
export function effectRows(
  theme: EffectTheme,
  staysBefore: number | null,
  staysAfter: number,
): EffectRow[] {
  return EFFECT_LAYERS.filter((layer) => theme.before[layer] > 0 || theme.after[layer] > 0).map(
    (layer) => ({
      layer,
      before: theme.before[layer],
      after: theme.after[layer],
      rateBefore: staysBefore === null ? null : ratePer100(theme.before[layer], staysBefore),
      rateAfter: ratePer100(theme.after[layer], staysAfter),
    }),
  );
}

/** All the episodes of the same months a year ago, against that year's stays. */
export function lastYearRate(theme: EffectTheme): number | null {
  const year = theme.last_year;
  return year === null ? null : ratePer100(year.reviews + year.found + year.reported, year.stays);
}

export function hasEnoughStays(effect: NonNullable<PlanEffect>): boolean {
  return effect.stays_after >= EFFECT_MIN_STAYS;
}
