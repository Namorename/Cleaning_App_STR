import type { Language } from '@str-ops/shared';

import { formatNumber, formatPercent, NO_VALUE, type Better, type Change } from './format';
import type { Summary } from './schema';

/** The dictionary as the figures use it: a key and its values. */
export type Translate = (key: string, values?: Record<string, unknown>) => string;

/** One key figure: what it reads, how it is written, how its change is judged. */
export interface TileSpec {
  key: string;
  value: (summary: Summary) => number | null;
  /** How the figure reads on the tile. */
  show: (value: number | null, language: Language, t: Translate) => string;
  /** A count moves relatively; a share in points. */
  change: Change['kind'];
  better: Better;
  hint?: (summary: Summary, language: Language, t: Translate) => string;
}

export const TILE_KEY = 'panel.analytics.tiles.';

const count = (value: number | null, language: Language) => formatNumber(value, language);
const minutes = (value: number | null, language: Language, t: Translate) =>
  value === null ? NO_VALUE : t('panel.analytics.value.minutes', { value: formatNumber(value, language) });

/**
 * The owner's key figures (2026-10-14), in the order he named them, and the
 * tasks cancelled (2026-10-15): the page's tiles and the PDF's alike.
 */
export const TILES: readonly TileSpec[] = [
  {
    key: 'cleaningsDone',
    value: (s) => s.cleanings_done,
    show: count,
    change: 'relative',
    better: 'up',
    hint: (s, language, t) =>
      `${t(`${TILE_KEY}cleaningsDoneHint`)} · ${t(`${TILE_KEY}midstay`, { count: formatNumber(s.cleanings_done_midstay, language) })}`,
  },
  {
    key: 'cleaningsPlanned',
    value: (s) => s.cleanings_planned,
    show: count,
    change: 'relative',
    better: 'none',
    hint: (_s, _language, t) => t(`${TILE_KEY}cleaningsPlannedHint`),
  },
  {
    key: 'checkouts',
    value: (s) => s.checkouts,
    show: count,
    change: 'relative',
    better: 'up',
    hint: (s, language, t) =>
      t(`${TILE_KEY}roomsReleased`, { count: formatNumber(s.rooms_released, language) }),
  },
  {
    key: 'problemsResolved',
    value: (s) => s.problems_resolved,
    show: count,
    change: 'relative',
    better: 'up',
  },
  {
    key: 'problemsOpen',
    value: (s) => s.problems_open,
    show: count,
    change: 'relative',
    better: 'down',
    hint: (_s, _language, t) => t(`${TILE_KEY}problemsOpenHint`),
  },
  {
    // Not a task of the other figures (owner, 2026-10-15), so counted apart.
    key: 'problemsCancelled',
    value: (s) => s.problems_cancelled,
    show: count,
    change: 'relative',
    better: 'none',
    hint: (_s, _language, t) => t(`${TILE_KEY}problemsCancelledHint`),
  },
  {
    key: 'urgencyAvg',
    value: (s) => s.urgency_avg,
    show: (value, language) => formatNumber(value, language, 2),
    change: 'relative',
    better: 'none',
    hint: (_s, _language, t) => t(`${TILE_KEY}urgencyHint`),
  },
  {
    key: 'cleaningMinutesMedian',
    value: (s) => s.cleaning_minutes_median,
    show: minutes,
    change: 'relative',
    better: 'none',
    hint: (s, language, t) =>
      t(`${TILE_KEY}cleaningMinutesHint`, { value: minutes(s.cleaning_minutes_avg, language, t) }),
  },
  {
    key: 'photoShare',
    value: (s) => s.photo_share,
    show: (value, language) => formatPercent(value, language),
    change: 'points',
    better: 'up',
  },
  {
    key: 'occupancy',
    value: (s) => s.occupancy,
    show: (value, language) => formatPercent(value, language),
    change: 'points',
    better: 'up',
    hint: (s, language, t) =>
      t(`${TILE_KEY}occupancyHint`, {
        occupied: formatNumber(s.occupied_nights, language),
        available: formatNumber(s.available_nights, language),
      }),
  },
];
