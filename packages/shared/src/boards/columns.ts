import { BOARD_COLUMNS, LAST_BOARD_COLUMN, type BoardColumn, type CardColor } from './cards';

/**
 * A manager board's own columns (20261126120000, docs/manager-boards.md «Этап 4»). Every board has
 * its columns in order — a new one the four of the technicians' board — and some of them
 * finishing. A card stands in one by `column_id`; its `column_key` is the stage of that column,
 * one of the four keys older clients read and move by, kept by the server: a finishing column is
 * `resolved`, so «done», «overdue» and the summary read a card by its key as before.
 *
 * Pure functions and data: no React, no DOM, no react-native.
 */

/** A column as both apps read it from `manager_board_columns`. */
export interface BoardColumnRow {
  readonly id: string;
  readonly board_id: string;
  /** The name people gave it; null for a preset column nobody renamed. */
  readonly title: string | null;
  /** One of the four keys for a column a board was made with; null for one added since. */
  readonly preset: string | null;
  readonly position: number;
  readonly is_done: boolean;
  /** The stage older clients read its cards by; `resolved` for a finishing column. */
  readonly legacy_key: string;
  readonly deleted_at: string | null;
  /** When it was made; absent in a row an older reader did not ask for. */
  readonly created_at?: string;
}

/** The server's limits (save_manager_board_column): a name of 1..40, up to 12 live columns. */
export const BOARD_COLUMN_LIMITS = {
  title: 40,
  columns: 12,
} as const;

/** A board's live columns in their order. */
export function liveColumns<T extends BoardColumnRow>(
  columns: readonly T[],
  boardId?: string,
): T[] {
  return columns
    .filter(
      (column) =>
        column.deleted_at === null && (boardId === undefined || column.board_id === boardId),
    )
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/** The key whose word names a preset column (`problems.statuses.*`), or null for a named one. */
export function presetKeyOf(column: Pick<BoardColumnRow, 'title' | 'preset'>): BoardColumn | null {
  if (column.title !== null) {
    return null;
  }
  return (BOARD_COLUMNS as readonly string[]).includes(column.preset ?? '')
    ? (column.preset as BoardColumn)
    : null;
}

/**
 * A column's name: its own, or its preset's word in the reader's language (`presetName` turns a
 * key into it, e.g. `key => t(`problems.statuses.${key}`)`).
 */
export function columnName(
  column: Pick<BoardColumnRow, 'title' | 'preset' | 'legacy_key'>,
  presetName: (key: BoardColumn) => string,
): string {
  if (column.title !== null) {
    return column.title;
  }
  const key = presetKeyOf(column);
  return presetName(key ?? (column.legacy_key as BoardColumn));
}

/** The first finishing column of a board, where a card with every step ticked is offered; or none. */
export function firstDoneColumn<T extends BoardColumnRow>(columns: readonly T[]): T | null {
  return liveColumns(columns).find((column) => column.is_done) ?? null;
}

/** Whether a card stands in a finishing column: its key says so (the server keeps it). */
export function isInDoneColumn(card: { readonly column_key: string }): boolean {
  return card.column_key === LAST_BOARD_COLUMN;
}

/** The live columns a column's cards may move to when it is deleted: every other one. */
export function moveTargets<T extends BoardColumnRow>(columns: readonly T[], leaving: string): T[] {
  return liveColumns(columns).filter((column) => column.id !== leaving);
}

/**
 * The stripes of the columns a manager added (owner, 2026-11-26): each its own colour of the card
 * palette, in the order they were made — not the colours the four presets draw in (violet, blue,
 * green), so a new column never looks like one of them while the palette lasts.
 */
export const CUSTOM_COLUMN_COLORS: readonly CardColor[] = [
  'orchid',
  'teal',
  'olive',
  'sky',
  'slate',
  'green',
  'violet',
  'blue',
];

/**
 * The colour of every column a manager added, by its id: the palette in the order the board's added
 * columns were made, deleted ones counted — a column keeps its colour when another is moved or
 * deleted. A preset column has none (it draws in its stage's tone).
 */
export function addedColumnColors(columns: readonly BoardColumnRow[]): Map<string, CardColor> {
  const added = columns
    .filter((column) => column.preset === null)
    .sort(
      (left, right) =>
        (left.created_at ?? '').localeCompare(right.created_at ?? '') ||
        left.id.localeCompare(right.id),
    );
  return new Map(
    added.map((column, index) => [
      column.id,
      CUSTOM_COLUMN_COLORS[index % CUSTOM_COLUMN_COLORS.length],
    ]),
  );
}

/** May one more column be added? */
export function canAddColumn(columns: readonly BoardColumnRow[]): boolean {
  return liveColumns(columns).length < BOARD_COLUMN_LIMITS.columns;
}

/** May a column be deleted? Never the last live one. */
export function canDeleteColumn(columns: readonly BoardColumnRow[]): boolean {
  return liveColumns(columns).length > 1;
}

/** The order after moving one column a step up (-1) or down (+1): ids, every live column once. */
export function columnOrderAfterStep(
  columns: readonly BoardColumnRow[],
  columnId: string,
  step: -1 | 1,
): string[] {
  const ids = liveColumns(columns).map((column) => column.id);
  const from = ids.indexOf(columnId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) {
    return ids;
  }
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** The order after dragging one column onto another's place: ids, every live column once. */
export function columnOrderAfterDrop(
  columns: readonly BoardColumnRow[],
  columnId: string,
  targetId: string,
): string[] {
  const ids = liveColumns(columns).map((column) => column.id);
  const from = ids.indexOf(columnId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) {
    return ids;
  }
  const next = ids.filter((id) => id !== columnId);
  next.splice(to, 0, columnId);
  return next;
}
