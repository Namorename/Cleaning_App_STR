import { BOARD_COLUMNS, columnName, liveColumns, type BoardColumn } from '@str-ops/shared';

import type { BoardCard, ColumnRow } from './schema';

/**
 * The lanes a board is drawn in (20261126120000): a manager board's own columns, or — on «Назначено
 * мне», where the cards of every board meet — the four stages every column stands for.
 */
export interface BoardLane {
  /** What `laneOf` answers for a card standing in it: a column's id, or a stage's key. */
  readonly key: string;
  readonly name: string;
  /** The stage whose tone and glyph head it (`problems.statuses.*`). */
  readonly stage: BoardColumn;
}

/** Names a preset column, or a stage, in the reader's language: `key => t(…statuses.<key>)`. */
export type PresetName = (key: BoardColumn) => string;

/** A board's live columns as its lanes, in their order. */
export function columnLanes(
  columns: readonly ColumnRow[],
  boardId: string,
  presetName: PresetName,
): BoardLane[] {
  return liveColumns(columns, boardId).map((column) => ({
    key: column.id,
    name: columnName(column, presetName),
    stage: column.legacy_key,
  }));
}

/** The four stages as lanes, under the technicians' board's words. */
export function stageLanes(presetName: PresetName): BoardLane[] {
  return BOARD_COLUMNS.map((stage) => ({ key: stage, name: presetName(stage), stage }));
}

/**
 * The lane of a board a card stands in: its column. A column the lanes do not hold — deleted while
 * the cards were not read again yet — puts the card in the first lane of its stage, else the first:
 * a card never drops off the board between two reads.
 */
export function laneOfCard(
  card: Pick<BoardCard, 'column_id' | 'column_key'>,
  lanes: readonly BoardLane[],
): string {
  if (lanes.some((lane) => lane.key === card.column_id)) {
    return card.column_id;
  }
  return (lanes.find((lane) => lane.stage === card.column_key) ?? lanes[0])?.key ?? card.column_id;
}

/**
 * Where a card of «Назначено мне» moved to a stage lands: its board's first live column of that
 * stage — the column the server picks for the stage too — or none when the board has no column of
 * it (the move is not offered then).
 */
export function stageColumn<T extends ColumnRow>(
  columns: readonly T[],
  boardId: string,
  stage: BoardColumn,
): T | null {
  return liveColumns(columns, boardId).find((column) => column.legacy_key === stage) ?? null;
}

/** A column's name by its id, a deleted one too (the journal names it); null for one not read. */
export function columnNameById(
  columns: readonly ColumnRow[],
  columnId: string,
  presetName: PresetName,
): string | null {
  const column = columns.find((candidate) => candidate.id === columnId);
  return column === undefined ? null : columnName(column, presetName);
}
