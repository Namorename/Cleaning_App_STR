import { z } from 'zod';

import { FINDING_TABS, type FindingStatus, type FindingTab } from './schema';

/** The channels the company's reviews come from: the three of public.signal_channel in use. */
export const REVIEW_CHANNELS = ['airbnb', 'booking', 'vrbo'] as const;
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number];

/** The categories a review rates, in one vocabulary for every channel (the functions' CATEGORY_KEYS). */
export const REVIEW_CATEGORIES = [
  'cleanliness',
  'accuracy',
  'checkin',
  'communication',
  'location',
  'value',
  'comfort',
  'facilities',
  'staff',
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

/** «Низкая оценка по категории»: one category, or any of them. */
export type LowCategory = ReviewCategory | 'any';

/** The findings' tabs a review can be looked up by: «Найдено», «Принятые», «Отклонённые», «Привязаны». */
export const REVIEW_FINDING_FILTERS = [
  'found',
  'accepted',
  'rejected',
  'linked',
] as const satisfies readonly FindingTab[];
export type ReviewFindingFilter = (typeof REVIEW_FINDING_FILTERS)[number];

/**
 * Every rating is out of 10 (Airbnb's stars twice over, Booking.com's own
 * scale): «Низкие» are three stars or less, 6 or less on Booking.com.
 */
export const LOW_RATING_MAX = 6;
export const RATING_MIN = 0;
export const RATING_MAX = 10;

/** «Все отзывы» filtered on the server; every part narrows, and they all hold at once. */
export interface ReviewFilters {
  channels: ReviewChannel[];
  /** The listing a review was left on (guest_signals.property_id). */
  placeIds: number[];
  ratingMin: number | null;
  ratingMax: number | null;
  /** `YYYY-MM`: a cut stay keeps the month of its departure only, so the period is in months. */
  monthFrom: string | null;
  monthTo: string | null;
  /** The guest wrote a public review (the PMS says so; the text itself is rarely kept). */
  withText: boolean;
  withPrivate: boolean;
  hiddenOnly: boolean;
  lowCategory: LowCategory | null;
  findings: ReviewFindingFilter[];
}

export const EMPTY_REVIEW_FILTERS: ReviewFilters = {
  channels: [],
  placeIds: [],
  ratingMin: null,
  ratingMax: null,
  monthFrom: null,
  monthTo: null,
  withText: false,
  withPrivate: false,
  hiddenOnly: false,
  lowCategory: null,
  findings: [],
};

export function hasReviewFilters(filters: ReviewFilters): boolean {
  return reviewFiltersKey(filters) !== reviewFiltersKey(EMPTY_REVIEW_FILTERS);
}

/** One string per set of filters: the query's key, and what sends the pager back to its first page. */
export function reviewFiltersKey(filters: ReviewFilters): string {
  return JSON.stringify(filters);
}

/** The two ends of a range typed the wrong way round are read the right way round. */
export function withOrderedBounds(filters: ReviewFilters): ReviewFilters {
  const { ratingMin, ratingMax, monthFrom, monthTo } = filters;
  const swapRating = ratingMin !== null && ratingMax !== null && ratingMin > ratingMax;
  const swapMonth = monthFrom !== null && monthTo !== null && monthFrom > monthTo;
  if (!swapRating && !swapMonth) {
    return filters;
  }
  return {
    ...filters,
    ratingMin: swapRating ? ratingMax : ratingMin,
    ratingMax: swapRating ? ratingMin : ratingMax,
    monthFrom: swapMonth ? monthTo : monthFrom,
    monthTo: swapMonth ? monthFrom : monthTo,
  };
}

/** The statuses of the findings the chosen tabs stand for. */
export function findingStatusesOf(filters: ReviewFilters): FindingStatus[] {
  return [...new Set(filters.findings.flatMap((tab) => [...FINDING_TABS[tab]]))];
}

/** The first day of the month after `YYYY-MM`. */
export function nextMonthStart(month: string): string {
  const [year, number] = month.split('-').map(Number);
  const next = number === 12 ? { year: year + 1, number: 1 } : { year, number: number + 1 };
  return `${next.year}-${String(next.number).padStart(2, '0')}-01`;
}

/** The departure days the period covers: from the first of its first month, before the first after its last. */
export function departureBounds(filters: ReviewFilters): {
  from: string | null;
  before: string | null;
} {
  return {
    from: filters.monthFrom === null ? null : `${filters.monthFrom}-01`,
    before: filters.monthTo === null ? null : nextMonthStart(filters.monthTo),
  };
}

/** The `or` of PostgREST for «any category rated low»: a category the channel never rates never matches. */
export function anyCategoryLow(): string {
  return REVIEW_CATEGORIES.map(
    (category) => `category_ratings->${category}.lte.${LOW_RATING_MAX}`,
  ).join(',');
}

/** The months a period can name, newest first: `count` of them back from `today`'s month. */
export function recentMonths(today: string, count: number): string[] {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

// ---------------------------------------------------------------- address

export const GUEST_TABS = [
  ...(Object.keys(FINDING_TABS) as FindingTab[]),
  'all',
  'settings',
] as const;
export type GuestTab = FindingTab | 'all' | 'settings';

/** What «Гости» keep in their address, as «Уборки» do: the tab, and the filters of «Все отзывы». */
export interface GuestsAddress {
  tab: GuestTab;
  reviews: ReviewFilters;
}

export const DEFAULT_GUESTS_ADDRESS: GuestsAddress = {
  tab: 'found',
  reviews: EMPTY_REVIEW_FILTERS,
};

/** The names in the query, short because a manager may read and forward the link. */
const PARAM = {
  tab: 'tab',
  channels: 'channel',
  placeIds: 'place',
  ratingMin: 'rmin',
  ratingMax: 'rmax',
  monthFrom: 'from',
  monthTo: 'to',
  withText: 'text',
  withPrivate: 'private',
  hiddenOnly: 'hidden',
  lowCategory: 'low',
  findings: 'finding',
} as const;

const tabSchema = z.enum(GUEST_TABS);
const channelSchema = z.enum(REVIEW_CHANNELS);
const placeSchema = z.coerce.number().int().positive();
const ratingSchema = z.coerce.number().min(RATING_MIN).max(RATING_MAX);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const lowSchema = z.enum([...REVIEW_CATEGORIES, 'any']);
const findingSchema = z.enum(REVIEW_FINDING_FILTERS);
const FLAG_ON = '1';

/**
 * The address as the screen's state. Each value is checked on its own: an old
 * or hand-edited link loses the part that makes no sense and keeps the rest.
 */
export function readGuestsAddress(params: URLSearchParams): GuestsAddress {
  const one = <T>(schema: z.ZodType<T>, name: string): T | null => {
    const raw = params.get(name);
    if (raw === null || raw === '') {
      return null;
    }
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  };
  const list = <T>(schema: z.ZodType<T>, name: string): T[] => {
    const parts = (params.get(name) ?? '').split(',').filter((part) => part !== '');
    const read = parts.flatMap((part) => {
      const parsed = schema.safeParse(part);
      return parsed.success ? [parsed.data] : [];
    });
    return [...new Set(read)];
  };
  return {
    tab: one(tabSchema, PARAM.tab) ?? DEFAULT_GUESTS_ADDRESS.tab,
    reviews: {
      channels: list(channelSchema, PARAM.channels),
      placeIds: list(placeSchema, PARAM.placeIds),
      ratingMin: one(ratingSchema, PARAM.ratingMin),
      ratingMax: one(ratingSchema, PARAM.ratingMax),
      monthFrom: one(monthSchema, PARAM.monthFrom),
      monthTo: one(monthSchema, PARAM.monthTo),
      withText: params.get(PARAM.withText) === FLAG_ON,
      withPrivate: params.get(PARAM.withPrivate) === FLAG_ON,
      hiddenOnly: params.get(PARAM.hiddenOnly) === FLAG_ON,
      lowCategory: one(lowSchema, PARAM.lowCategory),
      findings: list(findingSchema, PARAM.findings),
    },
  };
}

/** The query for the state, without its `?`: only what differs from the defaults. */
export function writeGuestsAddress({ tab, reviews }: GuestsAddress): string {
  const flag = (on: boolean) => (on ? FLAG_ON : '');
  const number = (value: number | null) => (value === null ? '' : String(value));
  const entries: [string, string][] = [
    [PARAM.tab, tab === DEFAULT_GUESTS_ADDRESS.tab ? '' : tab],
    [PARAM.channels, reviews.channels.join(',')],
    [PARAM.placeIds, reviews.placeIds.join(',')],
    [PARAM.ratingMin, number(reviews.ratingMin)],
    [PARAM.ratingMax, number(reviews.ratingMax)],
    [PARAM.monthFrom, reviews.monthFrom ?? ''],
    [PARAM.monthTo, reviews.monthTo ?? ''],
    [PARAM.withText, flag(reviews.withText)],
    [PARAM.withPrivate, flag(reviews.withPrivate)],
    [PARAM.hiddenOnly, flag(reviews.hiddenOnly)],
    [PARAM.lowCategory, reviews.lowCategory ?? ''],
    [PARAM.findings, reviews.findings.join(',')],
  ];
  return new URLSearchParams(entries.filter(([, value]) => value !== '')).toString();
}
