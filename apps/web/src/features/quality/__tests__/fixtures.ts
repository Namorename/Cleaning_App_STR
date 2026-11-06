import type {
  QualityHistory,
  QualityMeta,
  QualityOverview,
  QualityPlace,
  QualityPlaceCard,
  QualityThemeRow,
} from '../schema';

/** A reading that is over, with both years of stays loaded. */
export const READ_HISTORY: QualityHistory = {
  enabled: true,
  weeks_done: 49,
  weeks_total: 49,
  stay_months: 24,
  stays_from: '2024-12-01',
  last_read_at: '2026-11-05T03:00:00+00:00',
};

/** Twelve months on 2026-11-06, with repairs on record since long before the window before. */
export const META: QualityMeta = {
  window: '12m',
  today: '2026-11-06',
  grain: 'month',
  from: '2025-12-01',
  prev_from: '2024-12-01',
  prev_to: '2025-11-30',
  rating_from: '2025-12-01',
  work_from: '2024-01-01',
  history: READ_HISTORY,
};

/** Six months: the window before is inside what is loaded. */
export const SIX_MONTHS: QualityMeta = {
  ...META,
  window: '6m',
  from: '2026-06-01',
  prev_from: '2025-12-01',
  prev_to: '2026-05-31',
  rating_from: '2026-06-01',
};

/** Fourteen days: counted in weeks, ratings of three months. */
export const FOURTEEN_DAYS: QualityMeta = {
  ...META,
  window: '14d',
  grain: 'week',
  from: '2026-10-19',
  prev_from: '2026-10-05',
  prev_to: '2026-10-18',
  rating_from: '2026-09-01',
};

export function placeOf(over: Partial<QualityPlace> = {}): QualityPlace {
  return {
    id: 1,
    name: 'Old Town flat',
    city: 'Prague',
    stays: 100,
    stays_prev: 100,
    rating_n: 30,
    rating_avg: 8.75,
    rating_n_prev: 20,
    rating_avg_prev: 8.5,
    ...over,
  };
}

export function themeOf(over: Partial<QualityThemeRow> = {}): QualityThemeRow {
  return {
    property_id: 1,
    theme: 'wifi',
    seasonal: false,
    reviews: 0,
    reviews_prev: 0,
    found: 0,
    found_prev: 0,
    reported: 0,
    reported_prev: 0,
    recent: 0,
    older: 0,
    last_on: '2026-10-01',
    open_work: 0,
    work_180: 0,
    closed_on: null,
    ...over,
  };
}

export function overviewOfRows(
  places: readonly QualityPlace[],
  themes: readonly QualityThemeRow[],
  meta: QualityMeta = META,
): QualityOverview {
  return { ...meta, places: [...places], themes: [...themes] };
}

export function cardOf(over: Partial<QualityPlaceCard> = {}): QualityPlaceCard {
  return {
    ...META,
    place: placeOf(),
    themes: [],
    months: [],
    channels: [],
    categories: [],
    ...over,
  };
}
