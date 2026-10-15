import { describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

import {
  chartQueries,
  cleanerBars,
  listingBars,
  seriesBucket,
  TOP_BARS,
  urgencyBars,
  urgencySummary,
} from '../chart-data';
import { NO_FILTERS, type AnalyticsQuery, type AnalyticsRows, type Summary } from '../schema';

const QUERY: AnalyticsQuery = {
  period: { from: '2026-10-01', to: '2026-10-31' },
  filters: {
    ...NO_FILTERS,
    propertyIds: [1, 2],
    personIds: ['11111111-1111-4111-8111-111111111111'],
    priorities: ['high'],
  },
  includeTest: false,
};

const SUMMARY: Summary = {
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
  problems_by_priority: { low: 1, normal: 0, high: 2 },
};

function listingRow(id: number, name: string, done: number): AnalyticsRows['cleaningsByProperty'] {
  return {
    listing_id: id,
    listing_name: name,
    planned: done,
    done,
    done_midstay: 0,
    expired: 0,
    cancelled: 0,
    minutes_median: null,
    minutes_avg: null,
    photo_share: null,
    total_count: 3,
  };
}

function cleanerRow(id: string, name: string | null, done: number): AnalyticsRows['cleaningsByCleaner'] {
  return {
    person_id: id,
    full_name: name,
    done,
    done_midstay: 0,
    planned: done,
    minutes_median: null,
    minutes_avg: null,
    photo_share: null,
    listings: 1,
    total_count: 2,
  };
}

describe('seriesBucket', () => {
  test('a period of up to sixty days goes by day, a longer one by week', () => {
    expect(seriesBucket({ from: '2026-09-01', to: '2026-10-30' })).toBe('day');
    expect(seriesBucket({ from: '2026-09-01', to: '2026-10-31' })).toBe('week');
  });
});

describe('chartQueries', () => {
  test('each bar list drops its own filter and keeps the others', () => {
    const queries = chartQueries(QUERY);
    expect(queries.byListing.filters.propertyIds).toEqual([]);
    expect(queries.byListing.filters.personIds).toEqual(QUERY.filters.personIds);
    expect(queries.byCleaner.filters.personIds).toEqual([]);
    expect(queries.byCleaner.filters.propertyIds).toEqual([1, 2]);
    expect(queries.byUrgency.filters.priorities).toEqual([]);
    expect(queries.byUrgency.filters.propertyIds).toEqual([1, 2]);
    expect(queries.byListing.period).toEqual(QUERY.period);
  });

  test('the bars are the busiest few', () => {
    expect(TOP_BARS).toBe(8);
  });
});

describe('the bars', () => {
  test('a listing bar for every listing with a cleaning done', () => {
    const bars = listingBars(
      [listingRow(1, 'Old Town flat', 3), listingRow(2, 'Quiet flat', 0)],
      'en',
    );
    expect(bars).toEqual([{ id: '1', label: 'Old Town flat', value: 3, valueText: '3' }]);
  });

  test('a cleaner bar names her as the page does: in full or by initials', () => {
    const rows = [
      cleanerRow('a', 'Anna Novak', 1234),
      cleanerRow('b', null, 2),
      cleanerRow('c', 'Eva Dvořák', 0),
    ];
    expect(cleanerBars(rows, 'full', 'cs').map((bar) => [bar.label, bar.valueText])).toEqual([
      ['Anna Novak', '1 234'],
      ['—', '2'],
    ]);
    expect(cleanerBars(rows, 'initials', 'en')[0].label).toBe('A. N.');
  });

  test('the urgency bars, low to high, in the page language', () => {
    const bars = urgencyBars(SUMMARY, i18n.getFixedT('en'), 'en');
    expect(bars.map((bar) => [bar.id, bar.value])).toEqual([
      ['low', 1],
      ['normal', 0],
      ['high', 2],
    ]);
    expect(bars.map((bar) => bar.label)).toEqual(['Low', 'Normal', 'High']);
    expect(urgencyBars(undefined, i18n.getFixedT('en'), 'en')).toEqual([]);
  });

  test('the urgency bars read the page summary unless urgency itself is filtered', () => {
    const other = { ...SUMMARY, problems_by_priority: { low: 9, normal: 9, high: 9 } };
    expect(urgencySummary(NO_FILTERS, SUMMARY, other)).toBe(SUMMARY);
    expect(urgencySummary({ ...NO_FILTERS, priorities: ['low'] }, SUMMARY, other)).toBe(other);
  });
});
