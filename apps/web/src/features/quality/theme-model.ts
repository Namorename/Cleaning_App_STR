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

/** From this day a window's stays are whole: short windows count bookings, long ones months read. */
export function staysFromOf(meta: QualityMeta): string | null {
  return meta.grain === 'week' ? meta.held_from : meta.history.stays_from;
}

/**
 * The one rule of both screens. Stays never read are unknown, not zero; once they are
 * read to the start of the window, a place with none really stood empty.
 */
export function coverageOf(meta: QualityMeta): StaysCoverage {
  const loadedFrom = staysFromOf(meta);
  if (loadedFrom === null) {
    return 'none';
  }
  return loadedFrom <= meta.from ? 'whole' : 'partial';
}

export type QualityLayer = 'reviews' | 'found' | 'reported';
export const QUALITY_LAYERS: readonly QualityLayer[] = ['reviews', 'found', 'reported'];

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

/** Who a theme's trend is read from. */
export type TrendBasis = 'reviews' | 'staff';

/** Why reviews are not compared, though there are two windows of them. */
type WithheldTrend = 'reviews_settling' | 'reviews_seam';

/** `hidden`: the reading of past reviews is not finished, so a window before is not whole. */
export type ThemeTrend = TrendLabel | WithheldTrend | 'hidden';

export type ComparedTrend = Extract<ThemeTrend, 'rising' | 'falling' | 'steady'>;

/** The trends that do hold one window against the other. */
export function isCompared(trend: ThemeTrend): trend is ComparedTrend {
  return trend === 'rising' || trend === 'falling' || trend === 'steady';
}

export interface ThemeLine {
  theme: QualityTheme;
  seasonal: boolean;
  layers: LayerCounts;
  /** A rate per layer it is read from; empty when `rateGap` says why, or nothing was said. */
  rates: readonly LayerRate[];
  rateGap: RateGap | null;
  basis: TrendBasis;
  trend: ThemeTrend;
  /** The day the two readers meet, while `trend` is `reviews_seam`. */
  seam: string | null;
  /** The last day a trend read from reviews counts, while such a trend stands. */
  settledTo: string | null;
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
  /** A short window: its reviews are still arriving, while the window before has settled. */
  reviewsArriving: boolean;
  /** The day reviews change readers, when these windows compare across it. */
  seam: string | null;
  /** Reviews are compared up to this day: later ones are still arriving. */
  settledTo: string;
}

/**
 * Before the texts' line a review is labelled by the reading, after it by the
 * stream's narrower reader, so a comparison across the line reads low whatever
 * happened. Reviews are compared only up to `settled_to`: while that lies before
 * the line, both windows are one reader's. The owner's decision of 2026-11-06, for
 * every scope: to lift it, return null here.
 */
function readersSeam({ line, prev_from, settled_to }: QualityMeta): string | null {
  return line !== null && settled_to >= line && prev_from < line ? line : null;
}

export function frameOf(meta: QualityMeta, coverage: StaysCoverage): Frame {
  const loadedFrom = staysFromOf(meta);
  return {
    window: meta.window,
    workFrom: meta.work_from,
    // A window before that is not whole would read as growth: the reading under
    // way and a reading never started are the same case here.
    showsTrends: readingOf(meta.history).kind === 'done',
    coverage,
    staysBeforeWhole: loadedFrom !== null && loadedFrom <= meta.prev_from,
    staffBeforeWhole: meta.work_from !== null && meta.work_from <= meta.prev_from,
    reviewsArriving: meta.grain === 'week',
    seam: readersSeam(meta),
    settledTo: meta.settled_to,
  };
}

export type Episodes = Pick<
  QualityThemeRow,
  | 'reviews'
  | 'reviews_prev'
  | 'reviews_settled'
  | 'found'
  | 'found_prev'
  | 'reported'
  | 'reported_prev'
>;

interface Stays {
  current: number;
  previous: number;
  /** The part of `current` a trend by reviews may stand on. */
  settled: number;
}

/** For the order of things only: no screen shows this number. */
export function weightOf(layers: LayerCounts): number {
  return layers.reviews + layers.found + layers.reported;
}

export function hasEpisodes(row: Episodes): boolean {
  return weightOf(row) > 0;
}

/** Whoever said more of a theme over both windows speaks for it; guests on a tie. */
function basisOf(row: Episodes): TrendBasis {
  const fromGuests = row.reviews + row.reviews_prev;
  const fromStaff = row.found + row.found_prev + row.reported + row.reported_prev;
  return fromGuests >= fromStaff ? 'reviews' : 'staff';
}

function isOfBasis(layer: QualityLayer, basis: TrendBasis): boolean {
  return (layer === 'reviews') === (basis === 'reviews');
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
  // Each layer on its own: a rate names one layer, so the staff's two get a line
  // each. The basis speaks for both windows: when it said nothing in this one,
  // the layers that did have the rate.
  const said = QUALITY_LAYERS.filter((layer) => row[layer] > 0);
  const ofBasis = said.filter((layer) => isOfBasis(layer, basisOf(row)));
  const rates = (ofBasis.length > 0 ? ofBasis : said).flatMap((layer) => {
    const rate = ratePer100(row[layer], stays);
    return rate === null ? [] : [{ layer, episodes: row[layer], stays, rate }];
  });
  return { rates, rateGap: null };
}

/** Why reviews may not be compared in these windows; staff are not held to it. */
function withheldReviews(frame: Frame): WithheldTrend | null {
  if (frame.reviewsArriving) {
    return 'reviews_settling';
  }
  return frame.seam === null ? null : 'reviews_seam';
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
  const fromReviews = basisOf(row) === 'reviews';
  const withheld = fromReviews ? withheldReviews(frame) : null;
  if (withheld !== null) {
    return withheld;
  }
  const hasBase = frame.staysBeforeWhole && (fromReviews || frame.staffBeforeWhole);
  return trendOf({
    scope,
    seasonal: row.seasonal,
    // Settled months alone: a month still filling has its stays and not yet its
    // reviews, and would read as a fall. No settled stays is no base.
    current: fromReviews ? row.reviews_settled : row.found + row.reported,
    previous: fromReviews ? row.reviews_prev : row.found_prev + row.reported_prev,
    stays: fromReviews ? stays.settled : stays.current,
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
  const trend = trendIn(frame, scope, row, stays);
  return {
    theme: row.theme,
    seasonal: row.seasonal,
    layers: { reviews: row.reviews, found: row.found, reported: row.reported },
    ...ratesOf(frame, scope, row, stays.current),
    basis: basisOf(row),
    trend,
    seam: trend === 'reviews_seam' ? frame.seam : null,
    settledTo: isCompared(trend) && basisOf(row) === 'reviews' ? frame.settledTo : null,
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
  const stays = {
    current: place.stays,
    previous: place.stays_prev,
    settled: place.stays_settled,
  };
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
