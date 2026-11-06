import {
  GROUP_MIN_PLACES,
  QUALITY_THEME_CODES,
  TOP_THEMES,
  trustOf,
  type QualityScope,
  type ThemeState,
  type TrustLevel,
} from '@str-ops/shared';

import type {
  QualityEpisodeLayer,
  QualityMonthRow,
  QualityOverview,
  QualityPlace,
  QualityPlaceCard,
  QualityThemeRow,
} from './schema';
import {
  byWeight,
  coverageOf,
  frameOf,
  hasEpisodes,
  lineOf,
  placeLines,
  readingOf,
  weightOf,
  type Episodes,
  type Frame,
  type LayerCounts,
  type PlaceThemeLine,
  type QualityLayer,
  type ReadingState,
  type StaysCoverage,
  type ThemeLine,
} from './theme-model';

/**
 * What the screens of «Качество объектов» say, from what the server answered:
 * place themes up to a city's group and the portfolio, the order of things, and
 * what a window has not got. What each theme may say is `theme-model.ts`.
 */

/** A chip of a place's row in the table. */
export const THEMES_IN_ROW = 3;

const NO_EPISODES: Episodes = {
  reviews: 0,
  reviews_prev: 0,
  reviews_settled: 0,
  found: 0,
  found_prev: 0,
  reported: 0,
  reported_prev: 0,
};

function sumEpisodes(rows: readonly Episodes[]): Episodes {
  return rows.reduce(
    (sum, row) => ({
      reviews: sum.reviews + row.reviews,
      reviews_prev: sum.reviews_prev + row.reviews_prev,
      reviews_settled: sum.reviews_settled + row.reviews_settled,
      found: sum.found + row.found,
      found_prev: sum.found_prev + row.found_prev,
      reported: sum.reported + row.reported,
      reported_prev: sum.reported_prev + row.reported_prev,
    }),
    NO_EPISODES,
  );
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

export interface ScopeView {
  scope: Extract<QualityScope, 'group' | 'portfolio'>;
  places: number;
  /** Null while the stays of the window are not all there. */
  stays: number | null;
  /** The themes said most, `TOP_THEMES` at most. */
  themes: readonly ThemeLine[];
  /** Whether any theme was said at all, on the screen or under the limit. */
  hasThemes: boolean;
}

function knownStays(frame: Frame, stays: number): number | null {
  return frame.coverage === 'whole' ? stays : null;
}

/**
 * Places up to a group or the portfolio, the themes said most first. A theme's rows
 * are read only for these places: the themes come for an archived place too, and
 * its stays do not.
 */
function scopeLines(
  frame: Frame,
  scope: ScopeView['scope'],
  places: readonly QualityPlace[],
  rows: readonly QualityThemeRow[],
): ThemeLine[] {
  const ids = new Set(places.map((place) => place.id));
  const own = rows.filter((row) => ids.has(row.property_id));
  const stays = {
    current: total(places.map((place) => place.stays)),
    previous: total(places.map((place) => place.stays_prev)),
    settled: total(places.map((place) => place.stays_settled)),
  };
  return QUALITY_THEME_CODES.flatMap((theme) => {
    const ofTheme = own.filter((row) => row.theme === theme);
    const sum = sumEpisodes(ofTheme);
    return hasEpisodes(sum)
      ? [lineOf(frame, scope, { ...sum, theme, seasonal: ofTheme[0].seasonal }, stays)]
      : [];
  }).sort(byWeight);
}

/** Every theme of the portfolio, not only the ones its block lifts. */
export function portfolioLinesOf(data: QualityOverview): readonly ThemeLine[] {
  return scopeLines(frameOf(data, coverageOf(data)), 'portfolio', data.places, data.themes);
}

function scopeOf(
  frame: Frame,
  scope: ScopeView['scope'],
  places: readonly QualityPlace[],
  rows: readonly QualityThemeRow[],
): ScopeView {
  const lines = scopeLines(frame, scope, places, rows);

  return {
    scope,
    places: places.length,
    stays: knownStays(frame, total(places.map((place) => place.stays))),
    themes: lines.slice(0, TOP_THEMES),
    hasThemes: lines.length > 0,
  };
}

export interface PlaceRowView {
  place: QualityPlace;
  /** Null while the stays of the window are not all there. */
  stays: number | null;
  /** The themes the row shows, the most important first. */
  themes: readonly PlaceThemeLine[];
  newThemes: number;
  returnedThemes: number;
  /** Null while the stays of the window are not all there: trust is read from them. */
  trust: TrustLevel | null;
  /** For the order only. */
  weight: number;
}

function placeRowOf(
  frame: Frame,
  place: QualityPlace,
  rows: readonly QualityThemeRow[],
): PlaceRowView {
  const lines = placeLines(frame, place, rows);
  const inState = (state: ThemeState) => lines.filter((line) => line.state === state).length;
  return {
    place,
    stays: knownStays(frame, place.stays),
    themes: lines.slice(0, THEMES_IN_ROW),
    newThemes: inState('new'),
    returnedThemes: inState('returned'),
    trust: frame.coverage === 'whole' ? trustOf(place.stays, place.rating_n) : null,
    weight: total(lines.map((line) => weightOf(line.layers))),
  };
}

/** Places with something returned or new first, then by what is said of them. */
function byNews(a: PlaceRowView, b: PlaceRowView): number {
  const hasNews = (row: PlaceRowView) => Number(row.newThemes + row.returnedThemes > 0);
  return (
    hasNews(b) - hasNews(a) ||
    b.returnedThemes - a.returnedThemes ||
    b.newThemes - a.newThemes ||
    b.weight - a.weight ||
    a.place.name.localeCompare(b.place.name)
  );
}

/** The mean of the rated reviews, each counted once: a place weighs what it was rated. */
function ratingOf(places: readonly QualityPlace[]): number | null {
  const rated = places.filter((place) => place.rating_n > 0 && place.rating_avg !== null);
  const reviews = total(rated.map((place) => place.rating_n));
  return reviews === 0
    ? null
    : total(rated.map((place) => (place.rating_avg ?? 0) * place.rating_n)) / reviews;
}

export interface OverviewTiles {
  stays: number | null;
  rated: number;
  average: number | null;
  newThemes: number;
  returnedThemes: number;
}

export type OverviewEmpty = 'no_places' | NothingSaid;

export interface OverviewFilters {
  city: string | null;
  onlyNew: boolean;
}

export interface OverviewView {
  reading: ReadingState;
  coverage: StaysCoverage;
  /** Empty unless the company groups its places by city (`city_groups`). */
  cities: readonly string[];
  /** The city the screen is narrowed to: one the answer no longer has is none. */
  city: string | null;
  tiles: OverviewTiles;
  portfolio: ScopeView;
  /** The chosen city as a group; null below `GROUP_MIN_PLACES` places. */
  group: ScopeView | null;
  /** The table, narrowed and in its order. */
  rows: readonly PlaceRowView[];
  empty: OverviewEmpty | null;
}

function citiesOf(places: readonly QualityPlace[]): string[] {
  return [...new Set(places.flatMap((place) => (place.city === null ? [] : [place.city])))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export type NothingSaid = 'no_data' | 'no_themes';

/**
 * Why no theme stands in the window, from the numbers beside it. Coverage comes
 * first: stays that were not read say nothing of a window, least of all that
 * nothing happened in it.
 */
function nothingSaid(coverage: StaysCoverage, numbers: readonly number[]): NothingSaid {
  return coverage === 'whole' && numbers.every((number) => number === 0) ? 'no_data' : 'no_themes';
}

function emptyOf(
  portfolio: ScopeView,
  coverage: StaysCoverage,
  tiles: OverviewTiles,
  places: number,
): OverviewEmpty | null {
  if (places === 0) {
    return 'no_places';
  }
  return portfolio.hasThemes ? null : nothingSaid(coverage, [tiles.stays ?? 0, tiles.rated]);
}

export function overviewOf(data: QualityOverview, filters: OverviewFilters): OverviewView {
  const coverage = coverageOf(data);
  const frame = frameOf(data, coverage);
  const cities = data.city_groups ? citiesOf(data.places) : [];
  const city = filters.city !== null && cities.includes(filters.city) ? filters.city : null;
  const inCity = data.places.filter((place) => place.city === city);

  const rows = data.places.map((place) => placeRowOf(frame, place, data.themes));
  const tiles: OverviewTiles = {
    stays: knownStays(frame, total(data.places.map((place) => place.stays))),
    rated: total(data.places.map((place) => place.rating_n)),
    average: ratingOf(data.places),
    newThemes: total(rows.map((row) => row.newThemes)),
    returnedThemes: total(rows.map((row) => row.returnedThemes)),
  };
  const portfolio = scopeOf(frame, 'portfolio', data.places, data.themes);

  return {
    reading: readingOf(data.history),
    coverage,
    cities,
    city,
    tiles,
    portfolio,
    group:
      city !== null && inCity.length >= GROUP_MIN_PLACES
        ? scopeOf(frame, 'group', inCity, data.themes)
        : null,
    rows: rows
      .filter((row) => city === null || row.place.city === city)
      .filter((row) => !filters.onlyNew || row.newThemes > 0)
      .sort(byNews),
    empty: emptyOf(portfolio, coverage, tiles, data.places.length),
  };
}

export type MonthBar = LayerCounts & { month: string };

const LAYER_OF: Readonly<Record<QualityLayer, QualityEpisodeLayer>> = {
  reviews: 'guest_review',
  found: 'found_at_work',
  reported: 'staff_report',
};

/** What the server reads of a place's year: the month of `today` and the eleven before. */
const MONTHS_SHOWN = 12;

function yearEndingAt(today: string): string[] {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: MONTHS_SHOWN }, (_, at) =>
    new Date(Date.UTC(year, month - MONTHS_SHOWN + at, 1)).toISOString().slice(0, 10),
  );
}

/**
 * The year ending at `today`, oldest first, the themes of each month counted by
 * layer: a quiet month stands as a zero, or the bars would close up over it. A
 * year with no episode at all has no bars: the screen says so instead.
 */
export function monthBarsOf(rows: readonly QualityMonthRow[], today: string): MonthBar[] {
  if (rows.length === 0) {
    return [];
  }
  return yearEndingAt(today).map((month) => {
    const inLayer = (layer: QualityLayer) =>
      total(
        rows
          .filter((row) => row.month === month && row.layer === LAYER_OF[layer])
          .map((row) => row.n),
      );
    return {
      month,
      reviews: inLayer('reviews'),
      found: inLayer('found'),
      reported: inLayer('reported'),
    };
  });
}

export interface PlaceCardView {
  reading: ReadingState;
  coverage: StaysCoverage;
  stays: number | null;
  trust: TrustLevel | null;
  /** New, returned or growing, `TOP_THEMES` at most (§6.2). */
  important: readonly PlaceThemeLine[];
  others: readonly PlaceThemeLine[];
  /** A theme's last episode is older than our record of repairs. */
  hasOldEpisodes: boolean;
  months: readonly MonthBar[];
  empty: NothingSaid | null;
}

function isImportant(line: PlaceThemeLine): boolean {
  return line.state === 'new' || line.state === 'returned' || line.trend === 'rising';
}

function isOlderThanRepairs(line: PlaceThemeLine, workFrom: string | null): boolean {
  return line.lastOn !== null && (workFrom === null || line.lastOn < workFrom);
}

export function placeCardOf(card: QualityPlaceCard): PlaceCardView {
  const coverage = coverageOf(card);
  const frame = frameOf(card, coverage);
  const lines = placeLines(frame, card.place, card.themes);
  const important = lines.filter(isImportant).slice(0, TOP_THEMES);
  const { stays, rating_n: rated } = card.place;

  return {
    reading: readingOf(card.history),
    coverage,
    stays: knownStays(frame, stays),
    trust: coverage === 'whole' ? trustOf(stays, rated) : null,
    important,
    others: lines.filter((line) => !important.includes(line)),
    hasOldEpisodes: lines.some((line) => isOlderThanRepairs(line, card.work_from)),
    months: monthBarsOf(card.months, card.today),
    empty: lines.length > 0 ? null : nothingSaid(coverage, [stays, rated, card.months.length]),
  };
}
