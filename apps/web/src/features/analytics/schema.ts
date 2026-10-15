import { Constants, type Database } from '@str-ops/shared';
import { z } from 'zod';

import type { Period } from './period';

type Enums = Database['public']['Enums'];
export type TaskStatus = Enums['task_status'];
export type ProblemStatus = Enums['problem_status'];
export type ProblemPriority = Enums['problem_priority'];

/**
 * What the server's analytics functions answer (20261015110000), checked on
 * the way in: a figure the page cannot read is a failure, not a silent zero.
 */

const count = z.number().int().nonnegative();
/** A mean, a median or a share: absent when there was nothing to count. */
const measure = z.number().nullable();

export const summarySchema = z.object({
  cleanings_done: count,
  cleanings_done_midstay: count,
  cleanings_planned: count,
  cleanings_planned_midstay: count,
  cleaning_minutes_median: measure,
  cleaning_minutes_avg: measure,
  cleanings_with_photo: count,
  photo_share: measure,
  checkouts: count,
  rooms_released: count,
  occupied_nights: count,
  available_nights: count,
  occupancy: measure,
  problems_created: count,
  problems_resolved: count,
  problems_open: count,
  urgency_avg: measure,
  /** Tasks created in the period by urgency (20261015120000). */
  problems_by_priority: z.object({ low: count, normal: count, high: count }),
});
export type Summary = z.infer<typeof summarySchema>;

/** The figures of one day or one week (analytics_series, 20261015120000). */
export const seriesPointSchema = z.object({
  bucket: z.iso.date(),
  cleanings_done: count,
  cleanings_planned: count,
  checkouts: count,
  problems_created: count,
  problems_resolved: count,
});
export type SeriesPoint = z.infer<typeof seriesPointSchema>;
export type SeriesBucket = 'day' | 'week';

const total = { total_count: count };

export const cleaningsByPropertySchema = z.object({
  listing_id: z.number(),
  listing_name: z.string(),
  planned: count,
  done: count,
  done_midstay: count,
  expired: count,
  cancelled: count,
  minutes_median: measure,
  minutes_avg: measure,
  photo_share: measure,
  ...total,
});

export const cleaningsByCleanerSchema = z.object({
  person_id: z.string(),
  full_name: z.string().nullable(),
  done: count,
  done_midstay: count,
  planned: count,
  minutes_median: measure,
  minutes_avg: measure,
  photo_share: measure,
  listings: count,
  ...total,
});

export const checkoutsByPropertySchema = z.object({
  listing_id: z.number(),
  listing_name: z.string(),
  checkouts: count,
  rooms_released: count,
  occupied_nights: count,
  available_nights: count,
  occupancy: measure,
  ...total,
});

export const problemsByPropertySchema = z.object({
  listing_id: z.number().nullable(),
  listing_name: z.string().nullable(),
  created: count,
  resolved: count,
  open_end: count,
  urgency_avg: measure,
  hours_to_resolve_avg: measure,
  ...total,
});

export const problemsByTechnicianSchema = z.object({
  person_id: z.string(),
  full_name: z.string().nullable(),
  repairs_done: count,
  repairs_open: count,
  problems_resolved: count,
  work_minutes_avg: measure,
  hours_to_resolve_avg: measure,
  ...total,
});

/** The five tables of the page, by the name the screen and the address use. */
export const ANALYTICS_TABLES = [
  'cleaningsByProperty',
  'cleaningsByCleaner',
  'checkoutsByProperty',
  'problemsByProperty',
  'problemsByTechnician',
] as const;
export type AnalyticsTable = (typeof ANALYTICS_TABLES)[number];

export interface AnalyticsRows {
  cleaningsByProperty: z.infer<typeof cleaningsByPropertySchema>;
  cleaningsByCleaner: z.infer<typeof cleaningsByCleanerSchema>;
  checkoutsByProperty: z.infer<typeof checkoutsByPropertySchema>;
  problemsByProperty: z.infer<typeof problemsByPropertySchema>;
  problemsByTechnician: z.infer<typeof problemsByTechnicianSchema>;
}

export const TABLE_SCHEMAS = {
  cleaningsByProperty: cleaningsByPropertySchema,
  cleaningsByCleaner: cleaningsByCleanerSchema,
  checkoutsByProperty: checkoutsByPropertySchema,
  problemsByProperty: problemsByPropertySchema,
  problemsByTechnician: problemsByTechnicianSchema,
} as const;

/** The filters every function takes; an empty list means "all". */
export interface AnalyticsFilters {
  propertyIds: readonly number[];
  personIds: readonly string[];
  taskStatuses: readonly TaskStatus[];
  problemStatuses: readonly ProblemStatus[];
  priorities: readonly ProblemPriority[];
  /** The archived listings left out; off by default — they count (owner, 2026-10-15). */
  hideArchived: boolean;
}

export const NO_FILTERS: AnalyticsFilters = {
  propertyIds: [],
  personIds: [],
  taskStatuses: [],
  problemStatuses: [],
  priorities: [],
  hideArchived: false,
};

/** A listing the filter offers: every one, the archived too (rooms are counted under theirs). */
export const listingSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.enum(Constants.public.Enums.property_status),
});
export type Listing = z.infer<typeof listingSchema>;

/** One question to the server: a period, the filters, the demo listings or not. */
export interface AnalyticsQuery {
  period: Period;
  filters: AnalyticsFilters;
  includeTest: boolean;
}

export interface TablePage {
  limit: number;
  offset: number;
}

/** A page of a table and the size of the whole of it. */
export interface TableSlice<T> {
  rows: T[];
  total: number;
}

/** How names of people are shown on the page and in its exports (owner, 2026-10-14). */
export const NAME_MODES = ['full', 'initials'] as const;
export type NameMode = (typeof NAME_MODES)[number];
