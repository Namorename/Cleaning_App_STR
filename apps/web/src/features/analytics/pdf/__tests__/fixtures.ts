import type { Language } from '@str-ops/shared';

import { i18n } from '@/lib/i18n';

import { NO_FILTERS, type AnalyticsRows, type SeriesPoint, type Summary } from '../../schema';
import type { ReportInput, ReportLookups } from '../report-model';

/** The report's test data: one company's October, invented. */

export const ANNA = '11111111-1111-4111-8111-111111111111';
export const GONE = '33333333-3333-4333-8333-333333333333';
/** A cleaner on the team who is not among the busiest bars. */
export const EVA = '44444444-4444-4444-8444-444444444444';

export const SUMMARY: Summary = {
  cleanings_done: 5,
  cleanings_done_midstay: 1,
  cleanings_planned: 6,
  cleanings_planned_midstay: 1,
  cleaning_minutes_median: 75,
  cleaning_minutes_avg: 80,
  cleanings_with_photo: 1,
  photo_share: 0.2,
  checkouts: 3,
  rooms_released: 2,
  occupied_nights: 6,
  available_nights: 40,
  occupancy: 0.15,
  problems_created: 3,
  problems_resolved: 2,
  problems_open: 2,
  problems_cancelled: 1,
  urgency_avg: 2,
  problems_by_priority: { low: 1, normal: 1, high: 1 },
};

export const EMPTY: Summary = {
  ...SUMMARY,
  cleanings_done: 0,
  cleanings_done_midstay: 0,
  cleanings_planned: 0,
  cleanings_planned_midstay: 0,
  cleaning_minutes_median: null,
  cleaning_minutes_avg: null,
  cleanings_with_photo: 0,
  photo_share: null,
  checkouts: 0,
  rooms_released: 0,
  occupied_nights: 0,
  occupancy: 0,
  problems_created: 0,
  problems_resolved: 0,
  problems_open: 0,
  problems_cancelled: 0,
  urgency_avg: null,
  problems_by_priority: { low: 0, normal: 0, high: 0 },
};

export const LOOKUPS: ReportLookups = {
  listingNames: [
    { id: '1', label: 'Old Town flat' },
    { id: '2', label: 'Gone flat (archived)' },
  ],
  people: [{ id: ANNA, label: 'Anna Novak' }],
  staff: [
    { id: ANNA, label: 'Anna Novak' },
    { id: '22222222-2222-4222-8222-222222222222', label: 'The Boss' },
  ],
};

/** Days of October from `from`, with a little of everything. */
export function days(count: number, from = 1): SeriesPoint[] {
  return Array.from({ length: count }, (_, at) => ({
    bucket: `2026-10-${String(from + at).padStart(2, '0')}`,
    cleanings_done: at % 3,
    cleanings_planned: 1,
    checkouts: at % 2,
    problems_created: at % 4 === 0 ? 1 : 0,
    problems_resolved: 0,
  }));
}

export function listingRow(
  id: number,
  name: string,
  done = 3,
): AnalyticsRows['cleaningsByProperty'] {
  return {
    listing_id: id,
    listing_name: name,
    planned: done + 1,
    done,
    done_midstay: 1,
    expired: 1,
    cancelled: 0,
    minutes_median: 45,
    minutes_avg: 45,
    photo_share: 0.5,
    total_count: 1,
  };
}

export const LISTING_ROW = listingRow(1, 'Old Town flat');

export const CLEANER_ROW: AnalyticsRows['cleaningsByCleaner'] = {
  person_id: ANNA,
  full_name: 'Anna Novak',
  done: 3,
  done_midstay: 0,
  planned: 3,
  minutes_median: 45,
  minutes_avg: 45,
  photo_share: 0.5,
  listings: 1,
  total_count: 1,
};

/** A report of October against September, in `language`. */
export function reportInput(language: Language, overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    language,
    t: i18n.getFixedT(language),
    period: { from: '2026-10-01', to: '2026-10-31' },
    previous: { from: '2026-09-01', to: '2026-09-30' },
    bucket: 'day',
    filters: NO_FILTERS,
    names: 'full',
    lookups: LOOKUPS,
    summary: SUMMARY,
    previousSummary: { ...SUMMARY, cleanings_done: 4 },
    series: days(31),
    bars: { byListing: [LISTING_ROW], byCleaner: [CLEANER_ROW], urgency: SUMMARY },
    tables: {
      cleaningsByProperty: [LISTING_ROW],
      cleaningsByCleaner: [CLEANER_ROW],
      checkoutsByProperty: [],
      problemsByProperty: [
        {
          listing_id: null,
          listing_name: null,
          created: 1,
          resolved: 0,
          open_end: 1,
          urgency_avg: 2,
          hours_to_resolve_avg: null,
          total_count: 1,
        },
      ],
      problemsByTechnician: [],
    },
    generatedAt: new Date('2026-10-15T18:41:00Z'),
    ...overrides,
  };
}
