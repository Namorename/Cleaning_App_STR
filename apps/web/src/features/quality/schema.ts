import { isQualityTheme, QUALITY_WINDOWS, type QualityTheme } from '@str-ops/shared';
import { z } from 'zod';

import { REVIEW_CATEGORIES, type ReviewCategory } from '@/features/guest-signals/review-filters';

/**
 * What quality_overview and quality_place answer (20261106120000), checked on
 * the way in: a figure the page cannot read is a failure, not a silent zero. A
 * code this build does not know is another matter: the list of themes grows on
 * the server first, so such a row is dropped and the rest of the screen stands.
 */

const count = z.number().int().nonnegative();
const day = z.iso.date();
/** An average: absent when there was nothing to count. */
const average = z.number().nullable();

const historySchema = z.object({
  enabled: z.boolean(),
  weeks_done: count,
  /** Unknown until the first week of the reading is done. */
  weeks_total: count.nullable(),
  stay_months: count,
  stays_from: day.nullable(),
  last_read_at: z.string().nullable(),
});
export type QualityHistory = z.infer<typeof historySchema>;

const metaSchema = z.object({
  window: z.enum(QUALITY_WINDOWS),
  today: day,
  grain: z.enum(['week', 'month']),
  from: day,
  prev_from: day,
  prev_to: day,
  /** The ratings' own window: a short window reads the ratings of three months. */
  rating_from: day,
  /** The first day repairs are on record for the company. */
  work_from: day.nullable(),
  /** From this day the bookings we hold are whole: what a short window's stays rest on. */
  held_from: day.nullable(),
  /** The texts' line: the reading labels reviews before it, the stream after it. */
  line: day.nullable(),
  /** The last day of the last month whose reviews have all come. */
  settled_to: day,
  /** Whether the company groups its places by city; the other places stand in otherwise. */
  city_groups: z.boolean(),
  history: historySchema,
  /** Chats are on (docs/guest-chats.md): their episodes come apart, as chats. */
  messages_on: z.boolean().default(false),
});
export type QualityMeta = z.infer<typeof metaSchema>;

const placeSchema = z.object({
  id: z.number(),
  name: z.string(),
  city: z.string().nullable(),
  stays: count,
  stays_prev: count,
  /** The window's stays up to `settled_to`. */
  stays_settled: count,
  rating_n: count,
  rating_avg: average,
  rating_n_prev: count,
  rating_avg_prev: average,
});
export type QualityPlace = z.infer<typeof placeSchema>;

const themeRowSchema = z.object({
  property_id: z.number(),
  theme: z.string(),
  seasonal: z.boolean(),
  reviews: count,
  reviews_prev: count,
  /** The window's reviews up to `settled_to`. */
  reviews_settled: count,
  found: count,
  found_prev: count,
  reported: count,
  reported_prev: count,
  /** Episodes from guests' chats, counted apart and never in a trend; zero while chats are off. */
  messages: count.default(0),
  messages_prev: count.default(0),
  recent: count,
  older: count,
  last_on: day.nullable(),
  open_work: count,
  work_180: count,
  closed_on: day.nullable(),
});

type KnownTheme<T> = Omit<T, 'theme'> & { theme: QualityTheme };
export type QualityThemeRow = KnownTheme<z.infer<typeof themeRowSchema>>;

function hasKnownTheme<T extends { theme: string }>(row: T): row is T & { theme: QualityTheme } {
  return isQualityTheme(row.theme);
}

const themeRows = themeRowSchema
  .array()
  .transform((rows): QualityThemeRow[] => rows.filter(hasKnownTheme));

/** The layers a screen may show: messages stay out until their switch (§4.8). */
const LAYERS = ['guest_review', 'found_at_work', 'staff_report'] as const;
export type QualityEpisodeLayer = (typeof LAYERS)[number];

function isEpisodeLayer(value: string): value is QualityEpisodeLayer {
  return (LAYERS as readonly string[]).includes(value);
}

const monthRowSchema = z.object({
  month: day,
  theme: z.string(),
  layer: z.string(),
  n: count,
});

export type QualityMonthRow = KnownTheme<z.infer<typeof monthRowSchema>> & {
  layer: QualityEpisodeLayer;
};

const monthRows = monthRowSchema
  .array()
  .transform((rows): QualityMonthRow[] =>
    rows.flatMap(({ layer, ...row }) =>
      hasKnownTheme(row) && isEpisodeLayer(layer) ? [{ ...row, layer }] : [],
    ),
  );

const channelSchema = z.object({
  channel: z.string(),
  n: count,
  average,
});
export type QualityChannel = z.infer<typeof channelSchema>;

const categorySchema = z.object({
  key: z.string(),
  n: count,
  average,
  /** The other places of the company, or of its city where it groups by city. */
  peers_n: count,
  peers_average: average,
});
export type QualityCategory = Omit<z.infer<typeof categorySchema>, 'key'> & { key: ReviewCategory };

function hasKnownCategory<T extends { key: string }>(row: T): row is T & { key: ReviewCategory } {
  return (REVIEW_CATEGORIES as readonly string[]).includes(row.key);
}

const categoryRows = categorySchema
  .array()
  .transform((rows): QualityCategory[] => rows.filter(hasKnownCategory));

export const overviewSchema = metaSchema.extend({
  places: placeSchema.array(),
  themes: themeRows,
});
export type QualityOverview = z.infer<typeof overviewSchema>;

export const placeCardSchema = metaSchema.extend({
  place: placeSchema,
  themes: themeRows,
  months: monthRows,
  channels: channelSchema.array(),
  categories: categoryRows,
});
export type QualityPlaceCard = z.infer<typeof placeCardSchema>;

/** Who says a place stands out. Never summed. */
export const AREA_BASES = ['guest', 'staff'] as const;
export type AreaBasis = (typeof AREA_BASES)[number];

const areaMemberSchema = z.object({
  theme: z.string(),
  property_id: z.number(),
  name: z.string(),
  basis: z.enum(AREA_BASES),
  episodes: count,
  stays: count,
});
export type QualityAreaMember = KnownTheme<z.infer<typeof areaMemberSchema>>;

export const areasSchema = z.object({
  window: z.enum(QUALITY_WINDOWS),
  /** Null until the nightly job has run. */
  computed_on: day.nullable(),
  members: areaMemberSchema
    .array()
    .transform((rows): QualityAreaMember[] => rows.filter(hasKnownTheme)),
});
export type QualityAreas = z.infer<typeof areasSchema>;
