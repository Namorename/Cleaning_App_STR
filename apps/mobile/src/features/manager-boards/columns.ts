import { BOARD_COLUMNS, columnName, LAST_BOARD_COLUMN } from '@str-ops/shared';
import type { TFunction } from 'i18next';

import type { BoardCard, ColumnRow } from './schema';

/**
 * A board's own columns on the phone (20261126120000): their names in the reader's language and
 * the column each card stands in. Pure: the shared rules (`liveColumns`, `firstDoneColumn`, …) live
 * in `@str-ops/shared`, one for the panel and the phone.
 */

/** A column's name: its own, or its preset's word in the reader's language (`problems.statuses.*`). */
export function columnLabel(
  column: Pick<ColumnRow, 'title' | 'preset' | 'legacy_key'>,
  t: TFunction,
): string {
  return columnName(column, (key) => t(`problems.statuses.${key}`));
}

/** The place of one of the four keys among them; -1 for a key this build does not know. */
function stageIndex(key: string): number {
  return (BOARD_COLUMNS as readonly string[]).indexOf(key);
}

/**
 * The live column a card stands in: its own (`column_id`). A card saved to disk by the build before
 * the columns has none, and a card whose column went meanwhile names one no longer live: such a
 * card stands where the server puts a card by its key (manager_board_column_for) until the next
 * read brings its column — a finishing column for `resolved` and one not finishing for any other
 * key while the board has one of that kind, then the nearest stage, then the earlier column. Null
 * for a key this build does not know, and on a board with no live column read yet.
 */
export function columnIdOf(
  card: Pick<BoardCard, 'column_id' | 'column_key'>,
  live: readonly ColumnRow[],
): string | null {
  if (card.column_id !== null && live.some((column) => column.id === card.column_id)) {
    return card.column_id;
  }
  const wanted = stageIndex(card.column_key);
  if (wanted < 0) {
    return null;
  }
  const isDone = card.column_key === LAST_BOARD_COLUMN;
  const otherKind = (column: ColumnRow) => (column.is_done === isDone ? 0 : 1);
  const distance = (column: ColumnRow) => Math.abs(stageIndex(column.legacy_key) - wanted);
  const nearest = [...live].sort(
    (left, right) =>
      otherKind(left) - otherKind(right) ||
      distance(left) - distance(right) ||
      left.position - right.position,
  );
  return nearest[0]?.id ?? null;
}

/** The pane of the archived and deleted cards, beside a board's lanes. */
export const ARCHIVE_PANE = 'archive';

/**
 * A pane of a board: one of its live columns — or, while its columns are not read yet (the first
 * open after the update without signal), one of the four stages its cards' keys name, as before
 * the columns, so the cards read before still show.
 */
export interface BoardLane {
  /** The column's id; the stage's key while the columns are not read. */
  readonly id: string;
  readonly label: string;
  /** The column a card is made in; null on a stage's pane, where none is made. */
  readonly column: ColumnRow | null;
}

/** A board's panes: its live columns in order (`live`), or the four stages while it is null. */
export function boardLanes(live: readonly ColumnRow[] | null, t: TFunction): BoardLane[] {
  if (live === null) {
    return BOARD_COLUMNS.map((key) => ({
      id: key,
      label: t(`problems.statuses.${key}`),
      column: null,
    }));
  }
  return live.map((column) => ({ id: column.id, label: columnLabel(column, t), column }));
}

/** The lane a card stands in: its column among `live`, or its stage while they are not read. */
export function laneIdOf(
  card: Pick<BoardCard, 'column_id' | 'column_key'>,
  live: readonly ColumnRow[] | null,
): string | null {
  return live === null ? card.column_key : columnIdOf(card, live);
}

/**
 * The pane shown: the archive when chosen; the lane chosen while it is there — a stage chosen
 * before the columns were read, its first column now; else the first lane; none without any.
 */
export function paneOf(chosen: string | null, lanes: readonly BoardLane[]): string | null {
  if (chosen === ARCHIVE_PANE) {
    return ARCHIVE_PANE;
  }
  const lane =
    lanes.find((one) => one.id === chosen) ??
    lanes.find((one) => one.column !== null && one.column.legacy_key === chosen) ??
    lanes[0];
  return lane?.id ?? null;
}

/** A column's name by its id among every column read — the deleted ones too; null for none. */
export function columnLabelById(
  columns: readonly ColumnRow[],
  columnId: string,
  t: TFunction,
): string | null {
  const column = columns.find((one) => one.id === columnId);
  return column === undefined ? null : columnLabel(column, t);
}
