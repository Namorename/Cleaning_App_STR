import type { Language } from '@str-ops/shared';

import type { CellValue } from '@/lib/csv';

import { formatNumber, formatPercent, personLabel } from './format';
import type { Period } from './period';
import type { AnalyticsRows, AnalyticsTable, NameMode } from './schema';

/** What a cell needs besides its row: the language, how names are shown, the dictionary. */
export interface ColumnContext {
  language: Language;
  names: NameMode;
  t: (key: string) => string;
}

/**
 * One column of a table: its header (an i18n key), the text on the screen
 * and the cell of an export — a number stays a number in a spreadsheet.
 */
export interface Column<R> {
  key: string;
  header: string;
  numeric: boolean;
  text: (row: R, context: ColumnContext) => string;
  cell: (row: R, context: ColumnContext) => CellValue;
}

const HEADER = 'panel.analytics.columns.';

function rounded(value: number | null, digits: number): number | null {
  if (value === null) {
    return null;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function listing<R extends { listing_name: string | null }>(): Column<R> {
  const name = (row: R, { t }: ColumnContext) => row.listing_name ?? t(`${HEADER}noListing`);
  return { key: 'listing', header: `${HEADER}listing`, numeric: false, text: name, cell: name };
}

function person<R extends { full_name: string | null }>(): Column<R> {
  const name = (row: R, { names }: ColumnContext) => personLabel(row.full_name, names);
  return { key: 'person', header: `${HEADER}person`, numeric: false, text: name, cell: name };
}

function count<R>(key: string, value: (row: R) => number): Column<R> {
  return {
    key,
    header: `${HEADER}${key}`,
    numeric: true,
    text: (row, { language }) => formatNumber(value(row), language),
    cell: (row) => value(row),
  };
}

function measure<R>(key: string, value: (row: R) => number | null, digits = 1): Column<R> {
  return {
    key,
    header: `${HEADER}${key}`,
    numeric: true,
    text: (row, { language }) => formatNumber(value(row), language, digits),
    cell: (row) => rounded(value(row), digits),
  };
}

/** A share (0–1): a percentage on the screen, a number of percent in an export. */
function share<R>(key: string, value: (row: R) => number | null): Column<R> {
  return {
    key,
    header: `${HEADER}${key}`,
    numeric: true,
    text: (row, { language }) => formatPercent(value(row), language),
    cell: (row) => {
      const fraction = value(row);
      return fraction === null ? null : rounded(fraction * 100, 1);
    },
  };
}

type Rows = AnalyticsRows;

/**
 * The columns of each table. A table shows the mean time of a cleaning; the
 * median is the tile's (owner, 2026-10-14).
 */
export const COLUMNS: { [T in AnalyticsTable]: readonly Column<Rows[T]>[] } = {
  cleaningsByProperty: [
    listing<Rows['cleaningsByProperty']>(),
    count('planned', (row) => row.planned),
    count('done', (row) => row.done),
    count('doneMidstay', (row) => row.done_midstay),
    count('expired', (row) => row.expired),
    count('cancelled', (row) => row.cancelled),
    measure('minutesAvg', (row) => row.minutes_avg),
    share('photoShare', (row) => row.photo_share),
  ],
  cleaningsByCleaner: [
    person<Rows['cleaningsByCleaner']>(),
    count('done', (row) => row.done),
    count('doneMidstay', (row) => row.done_midstay),
    count('planned', (row) => row.planned),
    measure('minutesAvg', (row) => row.minutes_avg),
    share('photoShare', (row) => row.photo_share),
    count('listings', (row) => row.listings),
  ],
  checkoutsByProperty: [
    listing<Rows['checkoutsByProperty']>(),
    count('checkouts', (row) => row.checkouts),
    count('roomsReleased', (row) => row.rooms_released),
    count('occupiedNights', (row) => row.occupied_nights),
    count('availableNights', (row) => row.available_nights),
    share('occupancy', (row) => row.occupancy),
  ],
  problemsByProperty: [
    listing<Rows['problemsByProperty']>(),
    count('created', (row) => row.created),
    count('resolved', (row) => row.resolved),
    count('openEnd', (row) => row.open_end),
    measure('urgencyAvg', (row) => row.urgency_avg, 2),
    measure('hoursToResolveAvg', (row) => row.hours_to_resolve_avg),
  ],
  problemsByTechnician: [
    person<Rows['problemsByTechnician']>(),
    count('repairsDone', (row) => row.repairs_done),
    count('repairsOpen', (row) => row.repairs_open),
    count('problemsResolved', (row) => row.problems_resolved),
    measure('workMinutesAvg', (row) => row.work_minutes_avg),
    measure('hoursToResolveAvg', (row) => row.hours_to_resolve_avg),
  ],
};

/** A table for a spreadsheet: the translated headers, then one row per row. */
export function exportRows<T extends AnalyticsTable>(
  table: T,
  rows: readonly Rows[T][],
  context: ColumnContext,
): CellValue[][] {
  const columns = COLUMNS[table] as readonly Column<Rows[T]>[];
  return [
    columns.map((column) => context.t(column.header)),
    ...rows.map((row) => columns.map((column) => column.cell(row, context))),
  ];
}

/** "analytics-checkouts-by-property-2026-10-01_2026-10-31.csv" */
export function exportFileName(table: AnalyticsTable, period: Period, extension: string): string {
  const kebab = table.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return `analytics-${kebab}-${period.from}_${period.to}.${extension}`;
}
