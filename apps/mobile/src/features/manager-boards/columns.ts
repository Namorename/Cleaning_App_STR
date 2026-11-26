import { BOARD_COLUMNS, columnName } from '@str-ops/shared';
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
 * card stands in the board's first live column of its stage, else of the nearest stage — the
 * server's rule (manager_board_column_for) — until the next read brings its column. Null for a key
 * this build does not know, and on a board with no live column read yet.
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
  const distance = (column: ColumnRow) => Math.abs(stageIndex(column.legacy_key) - wanted);
  const nearest = [...live].sort(
    (left, right) => distance(left) - distance(right) || left.position - right.position,
  );
  return nearest[0]?.id ?? null;
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
