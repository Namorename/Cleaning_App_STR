import type { HexColor, ThemeName } from '../design/tokens';
import { matchesAllTokens } from '../search';

/**
 * Manager boards (20261118200000, docs/manager-boards.md): what the panel and
 * the phone agree on about a card — its columns, its colours, its due date,
 * its progress, the links in its words, how a board is searched, filtered and
 * ordered. Pure functions and data: no React, no DOM, no react-native.
 */

/**
 * The four columns of a manager board: the technicians' board's, under the
 * same keys and the same words (`problems.statuses.*`). A card's column is its
 * own field, not a task's status: no counter of tasks reads it.
 */
export const BOARD_COLUMNS = ['open', 'assigned', 'in_progress', 'resolved'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/** Where finished work goes: the column a card with every step ticked is offered. */
export const LAST_BOARD_COLUMN: BoardColumn = 'resolved';

export function isBoardColumn(value: string): value is BoardColumn {
  return (BOARD_COLUMNS as readonly string[]).includes(value);
}

/**
 * The card palette: eight colours a manager tells her cards apart by, and
 * "none". No red, orange or yellow: those are the colours of urgency on every
 * screen (overdue, today, critical). The server knows the same eight names
 * (`manager_board_cards_color_known`).
 */
export const CARD_COLOR_NAMES = [
  'blue',
  'sky',
  'teal',
  'green',
  'olive',
  'violet',
  'orchid',
  'slate',
] as const;
export type CardColor = (typeof CARD_COLOR_NAMES)[number];

export function isCardColor(value: string | null | undefined): value is CardColor {
  return (
    value !== null && value !== undefined && (CARD_COLOR_NAMES as readonly string[]).includes(value)
  );
}

/** A card's colour in one theme: the stripe at its edge and the faint fill under its words. */
export interface CardColorValues {
  /** The stripe and the swatch: at least 3:1 on the surface. */
  readonly stripe: HexColor;
  /** The card's fill: the surface with a tenth of the stripe; body text reads on it at 6:1 and more. */
  readonly tint: HexColor;
}

export const CARD_COLORS = {
  light: {
    blue: { stripe: '#2f6fd6', tint: '#eceff8' },
    sky: { stripe: '#1683ad', tint: '#eaf1f4' },
    teal: { stripe: '#0e877b', tint: '#e9f1ef' },
    green: { stripe: '#3b8540', tint: '#edf1ea' },
    olive: { stripe: '#76761c', tint: '#f3f0e7' },
    violet: { stripe: '#7a55c7', tint: '#f3edf6' },
    orchid: { stripe: '#ad46a4', tint: '#f8ecf3' },
    slate: { stripe: '#64717d', tint: '#f1eff0' },
  },
  dark: {
    blue: { stripe: '#78a6f2', tint: '#353239' },
    sky: { stripe: '#5bb9de', tint: '#313536' },
    teal: { stripe: '#55bfae', tint: '#303530' },
    green: { stripe: '#76bf76', tint: '#353528' },
    olive: { stripe: '#bdbd5c', tint: '#3f3524' },
    violet: { stripe: '#ad91ea', tint: '#3c2f38' },
    orchid: { stripe: '#dc8ad3', tint: '#432e35' },
    slate: { stripe: '#a1acb7', tint: '#3b3331' },
  },
} as const satisfies Readonly<Record<ThemeName, Readonly<Record<CardColor, CardColorValues>>>>;

/** The server's limits (20261118200000), for the fields' maxLength and the counters. */
export const BOARD_LIMITS = {
  boardTitle: 80,
  cardTitle: 200,
  description: 10000,
  step: 500,
  steps: 100,
  comment: 4000,
} as const;

/**
 * Where a card's due date stands as of `today` (both `YYYY-MM-DD`): past it,
 * on it, within the coming week, later, or no date. A card in the last column
 * is done: its date no longer warns.
 */
export type DueState = 'overdue' | 'today' | 'week' | 'later' | 'none';

/** The days of «Неделя» after today: today and the six days after it. */
const WEEK_DAYS_AFTER_TODAY = 6;

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, date + days));
  return moved.toISOString().slice(0, 10);
}

export function dueState(dueOn: string | null, today: string, column: string): DueState {
  if (dueOn === null) {
    return 'none';
  }
  if (column === LAST_BOARD_COLUMN) {
    return 'later';
  }
  if (dueOn < today) {
    return 'overdue';
  }
  if (dueOn === today) {
    return 'today';
  }
  return dueOn <= addDays(today, WEEK_DAYS_AFTER_TODAY) ? 'week' : 'later';
}

/** A step as a board reads it: whether it is ticked, and its words where they were read. */
export interface CardStepMark {
  readonly done_at: string | null;
  readonly body?: string;
}

export interface StepCount {
  readonly done: number;
  readonly total: number;
}

export function stepCount(steps: readonly CardStepMark[]): StepCount {
  return {
    done: steps.filter((step) => step.done_at !== null).length,
    total: steps.length,
  };
}

/** Every step ticked — and there is at least one. */
export function isEveryStepDone(steps: readonly CardStepMark[]): boolean {
  return steps.length > 0 && steps.every((step) => step.done_at !== null);
}

/** A piece of a card's words: plain text, or a link to open. */
export type TextPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

const LINK = /https?:\/\/[^\s<>"']+/gi;
/** What a sentence puts after a link without it being part of it. */
const TRAILING = /[.,;:!?)\]}»"']+$/;
/** A link needs something after its scheme. */
const BARE_SCHEME = /^https?:\/\/$/i;

/**
 * The words with their `http(s)://` links found, for a description and a
 * comment: a link is shown as one to open, the rest as it was typed. A full
 * stop or a closing bracket after a link is the sentence's, not the link's.
 */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let from = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const tail = TRAILING.exec(raw)?.[0] ?? '';
    const href = raw.slice(0, raw.length - tail.length);
    if (BARE_SCHEME.test(href)) {
      continue;
    }
    if (start > from) {
      parts.push({ kind: 'text', text: text.slice(from, start) });
    }
    parts.push({ kind: 'link', text: href, href });
    from = start + href.length;
  }
  if (from < text.length) {
    parts.push({ kind: 'text', text: text.slice(from) });
  }
  return parts;
}

/** What a board is narrowed by. All empty: every card. */
export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';
export const DUE_FILTERS: readonly DueFilter[] = ['all', 'overdue', 'today', 'week', 'none'];

/** `'none'` in the colours is a card with no colour. */
export type ColorFilter = CardColor | 'none';

export interface CardFilters {
  readonly query: string;
  readonly colors: readonly ColorFilter[];
  readonly due: DueFilter;
  /** Only cards that still have a step to tick. */
  readonly openSteps: boolean;
}

export const EMPTY_CARD_FILTERS: CardFilters = {
  query: '',
  colors: [],
  due: 'all',
  openSteps: false,
};

export function hasCardFilters(filters: CardFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.colors.length > 0 ||
    filters.due !== 'all' ||
    filters.openSteps
  );
}

/** A card as the board's search, filters and order read it. */
export interface BoardCardFacts {
  readonly title: string;
  readonly description: string;
  readonly color: string | null;
  readonly due_on: string | null;
  readonly column_key: string;
  readonly created_at: string;
  readonly steps: readonly CardStepMark[];
}

function matchesDue(card: BoardCardFacts, due: DueFilter, today: string): boolean {
  const state = dueState(card.due_on, today, card.column_key);
  switch (due) {
    case 'all':
      return true;
    case 'overdue':
      return state === 'overdue';
    case 'today':
      return state === 'today';
    case 'week':
      return state === 'today' || state === 'week';
    case 'none':
      return state === 'none';
  }
}

/**
 * Does the card pass the board's search and filters? The search reads the
 * title, the description and the steps' words, every word typed in any order
 * (the rule of every search of both apps, `matchesAllTokens`).
 */
export function matchesCardFilters(
  card: BoardCardFacts,
  filters: CardFilters,
  today: string,
): boolean {
  if (filters.colors.length > 0) {
    const color: ColorFilter = isCardColor(card.color) ? card.color : 'none';
    if (!filters.colors.includes(color)) {
      return false;
    }
  }
  if (!matchesDue(card, filters.due, today)) {
    return false;
  }
  if (filters.openSteps && !card.steps.some((step) => step.done_at === null)) {
    return false;
  }
  if (filters.query.trim() === '') {
    return true;
  }
  const words = [card.title, card.description, ...card.steps.map((step) => step.body ?? '')];
  return matchesAllTokens(words.join('\n'), filters.query);
}

/** How a column's cards are ordered: by due date (the default), or the newest first. */
export type CardOrder = 'due' | 'newest';
export const CARD_ORDERS: readonly CardOrder[] = ['due', 'newest'];

function newestFirst(left: BoardCardFacts, right: BoardCardFacts): number {
  return right.created_at.localeCompare(left.created_at);
}

/**
 * A column's cards in their order. By due date: the nearest date first, the
 * cards with none after them, the newest first among equals.
 */
export function orderCards<T extends BoardCardFacts>(cards: readonly T[], order: CardOrder): T[] {
  return [...cards].sort((left, right) => {
    if (order === 'due' && left.due_on !== right.due_on) {
      if (left.due_on === null) {
        return 1;
      }
      if (right.due_on === null) {
        return -1;
      }
      return left.due_on.localeCompare(right.due_on);
    }
    return newestFirst(left, right);
  });
}

/** The line above a board: what is late, what is due today, how many cards are still open. */
export interface BoardSummary {
  readonly overdue: number;
  readonly today: number;
  readonly open: number;
}

export function boardSummary(cards: readonly BoardCardFacts[], today: string): BoardSummary {
  let overdue = 0;
  let dueToday = 0;
  let open = 0;
  for (const card of cards) {
    if (card.column_key === LAST_BOARD_COLUMN) {
      continue;
    }
    open += 1;
    const state = dueState(card.due_on, today, card.column_key);
    if (state === 'overdue') {
      overdue += 1;
    } else if (state === 'today') {
      dueToday += 1;
    }
  }
  return { overdue, today: dueToday, open };
}

/** The lines of a card's journal: a comment carries words, the rest are the server's facts. */
export const BOARD_ENTRY_KINDS = ['comment', 'moved', 'due_changed', 'step_done'] as const;
export type BoardEntryKind = (typeof BOARD_ENTRY_KINDS)[number];
