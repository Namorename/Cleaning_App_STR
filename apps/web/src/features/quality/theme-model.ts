import {
  QUALITY_THEME_CODES,
  RATE_MIN_STAYS,
  ratePer100,
  showsRate,
  stateRank,
  themeStateOf,
  trendOf,
  type QualityScope,
  type QualityTheme,
  type QualityWindow,
  type ThemeState,
  type TrendLabel,
} from '@str-ops/shared';

import type { QualityHistory, QualityMeta, QualityPlace, QualityThemeRow } from './schema';

/**
 * What may be said of one theme in one scope. Whether a number is enough to say
 * anything is @str-ops/shared's to decide (§3.3): this module only hands it the
 * right numbers, and withholds the ones whose other half is missing.
 */

export type ReadingState =
  | { kind: 'done' }
  /** Past reviews were not read: nothing older than the live stream is there. */
  | { kind: 'unread' }
  | { kind: 'reading'; done: number; total: number | null };

/** How far the reading of past reviews has got (§6.4). A reading left half way is not done. */
export function readingOf({ enabled, weeks_done, weeks_total }: QualityHistory): ReadingState {
  if (!enabled && weeks_done === 0) {
    return { kind: 'unread' };
  }
  return weeks_total === null || weeks_done < weeks_total
    ? { kind: 'reading', done: weeks_done, total: weeks_total }
    : { kind: 'done' };
}

/** Whether the stays of a window are all there: a rate on a part of them would be too high. */
export type StaysCoverage = 'whole' | 'partial' | 'none';

/** Short windows count bookings we hold; long ones the months read from the PMS. */
export function staysLoaded(meta: QualityMeta): StaysCoverage {
  if (meta.grain === 'week') {
    return 'whole';
  }
  const loadedFrom = meta.history.stays_from;
  if (loadedFrom === null) {
    return 'none';
  }
  return loadedFrom <= meta.from ? 'whole' : 'partial';
}

export type QualityLayer = 'reviews' | 'found' | 'reported';
export const QUALITY_LAYERS: readonly QualityLayer[] = ['reviews', 'found', 'reported'];
const STAFF_LAYERS = ['found', 'reported'] as const;

/** One number per layer: they are never summed into one on a screen (§2.3). */
export type LayerCounts = Readonly<Record<QualityLayer, number>>;

export interface LayerRate {
  layer: QualityLayer;
  episodes: number;
  stays: number;
  /** Episodes on 100 stays. */
  rate: number;
}

/** Why a theme shows its count alone. */
export type RateGap = 'stays_unknown' | 'few_stays' | 'short_window';

/** `hidden`: the reading of past reviews is not finished, so a window before is not whole. */
export type ThemeTrend = TrendLabel | 'hidden';

export interface ThemeLine {
  theme: QualityTheme;
  seasonal: boolean;
  layers: LayerCounts;
  /** A rate per layer it is read from; empty when `rateGap` says why, or nothing was said. */
  rates: readonly LayerRate[];
  rateGap: RateGap | null;
  trend: ThemeTrend;
}

export interface PlaceThemeLine extends ThemeLine {
  state: ThemeState;
  openWork: number;
  closedOn: string | null;
  lastOn: string | null;
}

/** What every line of one answer is judged against. */
export interface Frame {
  window: QualityWindow;
  workFrom: string | null;
  showsTrends: boolean;
  coverage: StaysCoverage;
  /** The stays of the window before are all there. */
  staysBeforeWhole: boolean;
  /** The window before is inside our record of staff episodes (§7.1, point 8). */
  staffBeforeWhole: boolean;
}

export function frameOf(meta: QualityMeta, coverage: StaysCoverage): Frame {
  const loadedFrom = meta.history.stays_from;
  return {
    window: meta.window,
    workFrom: meta.work_from,
    // A window before that is not whole would read as growth: the reading under
    // way and a reading never started are the same case here.
    showsTrends: readingOf(meta.history).kind === 'done',
    coverage,
    staysBeforeWhole:
      meta.grain === 'week' || (loadedFrom !== null && loadedFrom <= meta.prev_from),
    staffBeforeWhole: meta.work_from !== null && meta.work_from <= meta.prev_from,
  };
}

export type Episodes = Pick<
  QualityThemeRow,
  'reviews' | 'reviews_prev' | 'found' | 'found_prev' | 'reported' | 'reported_prev'
>;

interface Stays {
  current: number;
  previous: number;
}

/** For the order of things only: no screen shows this number. */
export function weightOf(layers: LayerCounts): number {
  return layers.reviews + layers.found + layers.reported;
}

export function hasEpisodes(row: Episodes): boolean {
  return weightOf(row) > 0;
}

/** Guests speak for a theme once they have said anything of it; until then, staff do. */
function isFromReviews(row: Episodes): boolean {
  return row.reviews > 0 || row.reviews_prev > 0;
}

function ratesOf(
  frame: Frame,
  scope: QualityScope,
  row: Episodes,
  stays: number,
): Pick<ThemeLine, 'rates' | 'rateGap'> {
  if (!hasEpisodes(row)) {
    return { rates: [], rateGap: null };
  }
  if (frame.coverage !== 'whole') {
    return { rates: [], rateGap: 'stays_unknown' };
  }
  if (!showsRate(scope, frame.window, stays)) {
    return { rates: [], rateGap: stays < RATE_MIN_STAYS ? 'few_stays' : 'short_window' };
  }
  // Each layer on its own: a rate names one layer, so the staff's two get a line each.
  const layers: readonly QualityLayer[] = isFromReviews(row)
    ? ['reviews']
    : STAFF_LAYERS.filter((layer) => row[layer] > 0);
  const rates = layers.flatMap((layer) => {
    const rate = ratePer100(row[layer], stays);
    return rate === null ? [] : [{ layer, episodes: row[layer], stays, rate }];
  });
  return { rates, rateGap: null };
}

function trendIn(
  frame: Frame,
  scope: QualityScope,
  row: Episodes & { seasonal: boolean },
  stays: Stays,
): ThemeTrend {
  if (!frame.showsTrends) {
    return 'hidden';
  }
  const fromReviews = isFromReviews(row);
  const hasBase = frame.staysBeforeWhole && (fromReviews || frame.staffBeforeWhole);
  return trendOf({
    scope,
    seasonal: row.seasonal,
    current: fromReviews ? row.reviews : row.found + row.reported,
    previous: fromReviews ? row.reviews_prev : row.found_prev + row.reported_prev,
    stays: stays.current,
    // No stays before: `trendOf`'s own way of saying there is nothing to compare with.
    staysPrevious: hasBase ? stays.previous : 0,
  });
}

export function lineOf(
  frame: Frame,
  scope: QualityScope,
  row: Episodes & Pick<QualityThemeRow, 'theme' | 'seasonal'>,
  stays: Stays,
): ThemeLine {
  return {
    theme: row.theme,
    seasonal: row.seasonal,
    layers: { reviews: row.reviews, found: row.found, reported: row.reported },
    ...ratesOf(frame, scope, row, stays.current),
    trend: trendIn(frame, scope, row, stays),
  };
}

function themeOrder(theme: QualityTheme): number {
  return QUALITY_THEME_CODES.indexOf(theme);
}

export function byWeight(a: ThemeLine, b: ThemeLine): number {
  return weightOf(b.layers) - weightOf(a.layers) || themeOrder(a.theme) - themeOrder(b.theme);
}

/** What nobody has answered first, then what is growing, then what is said most. */
function byImportance(a: PlaceThemeLine, b: PlaceThemeLine): number {
  return (
    stateRank(a.state) - stateRank(b.state) ||
    Number(b.trend === 'rising') - Number(a.trend === 'rising') ||
    byWeight(a, b)
  );
}

/** A theme stands in a window when it was said there, or live work is on it. */
function isInWindow(row: QualityThemeRow): boolean {
  return hasEpisodes(row) || row.open_work > 0;
}

/** The themes of a place in the window, the most important first. */
export function placeLines(
  frame: Frame,
  place: QualityPlace,
  rows: readonly QualityThemeRow[],
): PlaceThemeLine[] {
  const stays = { current: place.stays, previous: place.stays_prev };
  return rows
    .filter((row) => row.property_id === place.id && isInWindow(row))
    .map((row) => ({
      ...lineOf(frame, 'place', row, stays),
      state: themeStateOf({
        recent: row.recent,
        older: row.older,
        lastOn: row.last_on,
        closedOn: row.closed_on,
        openWork: row.open_work,
        work180: row.work_180,
        workFrom: frame.workFrom,
      }),
      openWork: row.open_work,
      closedOn: row.closed_on,
      lastOn: row.last_on,
    }))
    .sort(byImportance);
}
