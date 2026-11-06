import { QUALITY_THEME_CODES, type QualityTheme } from '@str-ops/shared';

import {
  AREA_BASES,
  type AreaBasis,
  type QualityAreaMember,
  type QualityAreas,
  type QualityOverview,
} from './schema';
import {
  coverageOf,
  readingOf,
  type ReadingState,
  type StaysCoverage,
  type ThemeLine,
} from './theme-model';
import { portfolioLinesOf } from './view-model';

/**
 * «Области»: which places a theme stands out at, as the night counted them, beside
 * what the overview says of that theme. Who belongs is the server's to decide.
 */

/** What one side says of a place: guests and staff are read apart, and never summed. */
export interface AreaPlaceLine {
  basis: AreaBasis;
  episodes: number;
  stays: number;
}

export interface AreaPlace {
  id: number;
  name: string;
  /** One line per side that says so, guests first. */
  lines: readonly AreaPlaceLine[];
}

export interface AreaRow {
  theme: QualityTheme;
  places: readonly AreaPlace[];
  /**
   * The theme across every place, the overview's own line. Never counted from the
   * members: they stand here for being high, so they would always seem to fall.
   * Null when the theme left the overview since the night counted it.
   */
  line: ThemeLine | null;
}

export type AreasEmpty = 'not_computed' | 'stays_unknown' | 'none';

export interface AreasModel {
  reading: ReadingState;
  coverage: StaysCoverage;
  /** The stays of the window, the empty state's denominator. */
  stays: number;
  computedOn: string | null;
  rows: readonly AreaRow[];
  empty: AreasEmpty | null;
}

/** A place once, in the server's order, with what each side says of it. */
function placesOf(members: readonly QualityAreaMember[]): AreaPlace[] {
  const ids = [...new Set(members.map((member) => member.property_id))];
  return ids.map((id) => {
    const own = members.filter((member) => member.property_id === id);
    return {
      id,
      name: own[0].name,
      lines: AREA_BASES.flatMap((basis) =>
        own
          .filter((member) => member.basis === basis)
          .map(({ episodes, stays }) => ({ basis, episodes, stays })),
      ),
    };
  });
}

/** The widest areas first. The sort is stable, so a tie keeps the order of the list. */
function rowsOf(members: readonly QualityAreaMember[], lines: readonly ThemeLine[]): AreaRow[] {
  return QUALITY_THEME_CODES.flatMap((theme) => {
    const own = members.filter((member) => member.theme === theme);
    return own.length === 0
      ? []
      : [{ theme, places: placesOf(own), line: lines.find((l) => l.theme === theme) ?? null }];
  }).sort((a, b) => b.places.length - a.places.length);
}

/**
 * Why there is nothing to list. Members counted on a part of the window's stays
 * would stand on a wrong denominator, so a window not whole lists none of them.
 */
function emptyOf(
  computedOn: string | null,
  coverage: StaysCoverage,
  rows: readonly AreaRow[],
): AreasEmpty | null {
  if (computedOn === null) {
    return 'not_computed';
  }
  if (coverage !== 'whole') {
    return 'stays_unknown';
  }
  return rows.length === 0 ? 'none' : null;
}

export function areasOf(areas: QualityAreas, overview: QualityOverview): AreasModel {
  const coverage = coverageOf(overview);
  const rows = rowsOf(areas.members, portfolioLinesOf(overview));
  const empty = emptyOf(areas.computed_on, coverage, rows);

  return {
    reading: readingOf(overview.history),
    coverage,
    stays: overview.places.reduce((sum, place) => sum + place.stays, 0),
    computedOn: areas.computed_on,
    rows: empty === null ? rows : [],
    empty,
  };
}
