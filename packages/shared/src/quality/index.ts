/**
 * Property quality: the closed list of themes and the rules of what may be said
 * about them (docs/property-intelligence-plan.md §2.1, §3.2, §3.3, §4.5). The
 * numbers come from the database; whether they are enough to say anything is
 * decided here, once, for the panel and for what comes after it.
 *
 * The list mirrors public.issue_themes; a Deno copy of the codes lives in
 * supabase/functions/_shared/signals/themes.ts, and a test holds the three
 * together.
 */

/** The display windows of the owner's decision of 2026-11-06. */
export const QUALITY_WINDOWS = ['14d', '1m', '3m', '6m', '12m'] as const;
export type QualityWindow = (typeof QUALITY_WINDOWS)[number];

/** The main window of a place (the same decision). */
export const DEFAULT_QUALITY_WINDOW: QualityWindow = '12m';

export function isQualityWindow(value: unknown): value is QualityWindow {
  return typeof value === 'string' && (QUALITY_WINDOWS as readonly string[]).includes(value);
}

export const THEME_GROUPS = [
  'engineering',
  'tech',
  'access',
  'cleanliness',
  'comfort',
  'surroundings',
  'service',
  'safety',
  'other',
] as const;
export type ThemeGroup = (typeof THEME_GROUPS)[number];

/** Code → group, in the order of public.issue_themes.sort_order. */
export const QUALITY_THEMES = {
  heating: 'engineering',
  hot_water: 'engineering',
  air_conditioning: 'engineering',
  plumbing: 'engineering',
  drain_toilet: 'engineering',
  shower_bath: 'engineering',
  electric_light: 'engineering',
  wifi: 'tech',
  tv: 'tech',
  kettle: 'tech',
  kitchen_appliance: 'tech',
  laundry_appliance: 'tech',
  appliance_other: 'tech',
  checkin_access: 'access',
  lock_door: 'access',
  lift_stairs: 'access',
  parking: 'access',
  cleanliness: 'cleanliness',
  smell: 'cleanliness',
  pests: 'cleanliness',
  mould_damp: 'cleanliness',
  bed_comfort: 'comfort',
  linen_towels: 'comfort',
  furniture: 'comfort',
  window_blind: 'comfort',
  room_temperature: 'comfort',
  supplies_amenities: 'comfort',
  noise_outside: 'surroundings',
  noise_neighbours: 'surroundings',
  location: 'surroundings',
  accuracy: 'service',
  communication: 'service',
  value: 'service',
  safety: 'safety',
  other: 'other',
} as const satisfies Record<string, ThemeGroup>;

export type QualityTheme = keyof typeof QUALITY_THEMES;

export const QUALITY_THEME_CODES = Object.keys(QUALITY_THEMES) as QualityTheme[];

export function isQualityTheme(value: unknown): value is QualityTheme {
  return typeof value === 'string' && Object.hasOwn(QUALITY_THEMES, value);
}

/** Below this many stays a place shows a count, never a rate (§3.3). */
export const RATE_MIN_STAYS = 20;
/** Below this many stays in either window a place shows no trend (§3.3). */
export const TREND_MIN_STAYS = 40;
/** The larger of the two numbers must reach this for a trend (§3.3). */
export const TREND_MIN_EPISODES = 5;
/** About one chance in twenty on one side (§3.3). */
export const TREND_Z = 1.65;
/** A group is shown from this many places (§3.2). */
export const GROUP_MIN_PLACES = 5;
/** What a card lifts to the top, so a manager is not given twenty things (§7.1). */
export const TOP_THEMES = 5;
/** «Новое»: at least this many episodes in 90 days, none in the 270 before (§3.3). */
export const NEW_MIN_EPISODES = 2;

/** A place, a group of places, or all of them. Each is allowed to say different things. */
export type QualityScope = 'place' | 'group' | 'portfolio';

export type TrendLabel =
  /** The window before has no stays: there is nothing to compare with. */
  | 'no_base'
  /** A place below the stays a trend needs. */
  | 'too_little'
  /** A seasonal theme at a place: only a year ago could tell, and a year is not there yet. */
  | 'seasonal'
  | 'rising'
  | 'falling'
  | 'steady';

export interface TrendInput {
  readonly scope: QualityScope;
  readonly seasonal: boolean;
  /** Episodes in the window and the window before. */
  readonly current: number;
  readonly previous: number;
  readonly stays: number;
  readonly staysPrevious: number;
}

/**
 * The rule of §3.3. The window's episodes are brought to the stays of the window
 * before, and the difference is held against what chance alone would do. A place
 * says it only with enough stays; a group and the portfolio say it always (the
 * owner's decision of 2026-11-06), as long as there is a window to compare with.
 */
export function trendOf(input: TrendInput): TrendLabel {
  const { scope, seasonal, current, previous, stays, staysPrevious } = input;
  if (scope === 'place' && seasonal) {
    return 'seasonal';
  }
  if (stays <= 0 || staysPrevious <= 0) {
    return 'no_base';
  }
  if (scope === 'place' && (stays < TREND_MIN_STAYS || staysPrevious < TREND_MIN_STAYS)) {
    return 'too_little';
  }
  const scaled = (current * staysPrevious) / stays;
  if (scaled + previous === 0) {
    return 'steady';
  }
  const z = Math.abs(scaled - previous) / Math.sqrt(scaled + previous);
  if (z < TREND_Z || Math.max(scaled, previous) < TREND_MIN_EPISODES) {
    return 'steady';
  }
  return scaled > previous ? 'rising' : 'falling';
}

/** Whether a rate may stand beside a count here (§3.2). A week's stays are too few at a place. */
export function showsRate(scope: QualityScope, window: QualityWindow, stays: number): boolean {
  if (stays < RATE_MIN_STAYS) {
    return false;
  }
  if (scope === 'portfolio') {
    return true;
  }
  if (scope === 'group') {
    return window !== '14d';
  }
  return window === '3m' || window === '6m' || window === '12m';
}

/** Episodes on 100 stays, to one decimal; null when there are no stays to count on. */
export function ratePer100(episodes: number, stays: number): number | null {
  return stays > 0 ? Math.round((episodes / stays) * 1000) / 10 : null;
}

export type ThemeState =
  /** Live work is on it. */
  | 'in_work'
  /** The work closed after the last episode. */
  | 'fixed'
  /** An episode came after the work closed. */
  | 'returned'
  /** At least two episodes in 90 days, none in the 270 before, no work for 180 days. */
  | 'new'
  /** One episode lately, and no work: not «new» yet. */
  | 'single'
  /** The last episode is older than our record of repairs: it may have been fixed. */
  | 'no_repair_data'
  | 'quiet';

export interface ThemeStateInput {
  /** Episodes of the last 90 days, and of the 270 before them. */
  readonly recent: number;
  readonly older: number;
  /** ISO days. */
  readonly lastOn: string | null;
  readonly closedOn: string | null;
  readonly openWork: number;
  readonly work180: number;
  /** The first day repairs are on record for the company. */
  readonly workFrom: string | null;
}

/** §4.5: what is known of a theme at a place. ISO days compare as text. */
export function themeStateOf(input: ThemeStateInput): ThemeState {
  const { recent, older, lastOn, closedOn, openWork, work180, workFrom } = input;
  if (openWork > 0) {
    return 'in_work';
  }
  if (closedOn !== null && lastOn !== null) {
    // `lastOn` is cut to its week or month, `closedOn` is a day. Most repairs close
    // in the week of their complaint: read the other way, each would be «Вернулось».
    return closedOn >= lastOn ? 'fixed' : 'returned';
  }
  if (recent > 0 && work180 === 0) {
    return recent >= NEW_MIN_EPISODES && older === 0 ? 'new' : 'single';
  }
  if (lastOn !== null && (workFrom === null || lastOn < workFrom)) {
    return 'no_repair_data';
  }
  return 'quiet';
}

/** Which come first on a card: what nobody has answered yet. */
const STATE_ORDER: readonly ThemeState[] = [
  'returned',
  'new',
  'in_work',
  'single',
  'fixed',
  'no_repair_data',
  'quiet',
];

export function stateRank(state: ThemeState): number {
  return STATE_ORDER.indexOf(state);
}

export type TrustLevel = 'high' | 'medium' | 'low';

/** How much a place's numbers can carry (§6.2): stays of the window, and rated reviews. */
export function trustOf(stays: number, rated: number): TrustLevel {
  if (stays >= TREND_MIN_STAYS && rated >= RATE_MIN_STAYS) {
    return 'high';
  }
  return stays >= RATE_MIN_STAYS ? 'medium' : 'low';
}

export * from './plans';
