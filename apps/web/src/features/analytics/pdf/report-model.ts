import { INTL_LOCALES, THEME_COLORS, TONE_COLORS, type Language } from '@str-ops/shared';

import { COMPANY_TIME_ZONE } from '@/features/problems/filters';
import { dateFormat, formatDay, formatShortDay } from '@/lib/format-date';

import {
  cleanerBars,
  listingBars,
  pickedCleanerBars,
  pickedListingBars,
  TOP_BARS,
  urgencyBars,
  type BarDatum,
} from '../chart-data';
import { niceMax, ticks } from '../charts/geometry';
import { COLUMNS, type Column, type ColumnContext } from '../columns';
import { listingFilterLabel, personFilterLabel, type FilterLookups } from '../filter-labels';
import { changeOf, formatChange, formatNumber, type Change } from '../format';
import { TILE_KEY, TILES, type Translate } from '../kpi-spec';
import type { Period } from '../period';
import {
  ANALYTICS_TABLES,
  type AnalyticsFilters,
  type AnalyticsRows,
  type AnalyticsTable,
  type NameMode,
  type SeriesBucket,
  type SeriesPoint,
  type Summary,
} from '../schema';
import { isEmptySummary } from '../summary';
import { fitToFont } from './font-coverage';

/**
 * The Analytics report as text and numbers, before any drawing: the page's
 * period, filters, figures, charts and tables, written in the page's
 * language. Pure — the PDF only lays it out (report-document.tsx).
 */

const PDF = 'panel.analytics.pdf.';
const CHARTS = 'panel.analytics.charts.';

/** The colours of the panel's light theme (the page's own --chart-1…4). */
export const REPORT_INK = {
  text: THEME_COLORS.light.text,
  muted: THEME_COLORS.light.textSecondary,
  divider: THEME_COLORS.light.divider,
  surfaceAlt: THEME_COLORS.light.surfaceAlt,
  primary: THEME_COLORS.light.primary,
  good: TONE_COLORS.light.done.fg,
  bad: TONE_COLORS.light.overdue.fg,
  chart1: THEME_COLORS.light.primary,
  chart2: THEME_COLORS.light.accent,
  chart3: TONE_COLORS.light.assigned.mark,
  chart4: TONE_COLORS.light.done.mark,
} as const;

/** A word longer than this may be cut inside to fit a cell; a shorter one never is. */
const LONG_WORD = 16;
/** The pieces a long word is cut into. */
const WORD_PIECE = 10;
/** A column heading is narrower: a word longer than this may be cut, in shorter pieces. */
const LONG_HEADING_WORD = 7;
const HEADING_PIECE = 4;
/** At most this many day or week labels under a column chart. */
const AXIS_LABELS = 10;
/** More bars than this in one list and the three lists no longer fit a page side by side. */
const BARS_SIDE_BY_SIDE = 20;

/** Who and what the filters name; the page waits for the team before it offers the report. */
export type ReportLookups = FilterLookups;

export type ReportTables = { [T in AnalyticsTable]: readonly AnalyticsRows[T][] };

/** Everything the report is made of, as the page has it. */
export interface ReportInput {
  language: Language;
  t: Translate;
  period: Period;
  /** The period compared with; null when the comparison is off. */
  previous: Period | null;
  bucket: SeriesBucket;
  filters: AnalyticsFilters;
  names: NameMode;
  lookups: ReportLookups;
  summary: Summary;
  previousSummary: Summary | null;
  series: readonly SeriesPoint[];
  /** The bar lists' own rows: each read without its own filter, as on the page. */
  bars: {
    byListing: readonly AnalyticsRows['cleaningsByProperty'][];
    byCleaner: readonly AnalyticsRows['cleaningsByCleaner'][];
    urgency: Summary | undefined;
  };
  /** Every row of every table. */
  tables: ReportTables;
  generatedAt: Date;
}

export interface ReportFilterLine {
  label: string;
  value: string;
}

export interface KpiModel {
  key: string;
  label: string;
  value: string;
  /** Null when the comparison is off. */
  change: string | null;
  tone: Change['tone'] | null;
  hint: string | null;
}

export interface LegendItem {
  name: string;
  color: string;
}

export interface ColumnModel {
  key: string;
  label: string;
  values: number[];
  /** Only some days or weeks are named under the axis, so the labels never crowd. */
  showLabel: boolean;
}

export interface ColumnChartModel {
  title: string;
  legend: LegendItem[];
  columns: ColumnModel[];
  top: number;
  ticks: number[];
  tickLabels: string[];
  /** Said in place of a chart with nothing in it. */
  emptyText: string | null;
}

export interface BarModel {
  label: string;
  value: number;
  valueText: string;
  /** The page is filtered to this bar: drawn marked, the others dimmed, as on the screen. */
  selected: boolean;
}

export interface BarChartModel {
  title: string;
  color: string;
  items: BarModel[];
  top: number;
  note: string | null;
  emptyText: string | null;
}

export interface TableModel {
  key: AnalyticsTable;
  title: string;
  headers: string[];
  numeric: boolean[];
  rows: string[][];
  emptyText: string | null;
}

export interface ReportModel {
  language: Language;
  title: string;
  /** Repeated at the top of every page after the first. */
  runningHead: string;
  periodLine: string;
  comparedLine: string | null;
  filtersTitle: string;
  filters: ReportFilterLine[];
  noFiltersText: string;
  generatedLine: string;
  pageText: (page: number, total: number) => string;
  /** The period had nothing to count: the report is this message alone. */
  empty: { title: string; body: string } | null;
  kpiTitle: string;
  kpis: KpiModel[];
  chartsTitle: string;
  columnCharts: ColumnChartModel[];
  barCharts: BarChartModel[];
  /**
   * A list too long for a page (many picks beyond the busiest): the lists go
   * one under another and may run on over the pages, rather than being cut.
   */
  barListsStacked: boolean;
  tablesTitle: string;
  tables: TableModel[];
  notesTitle: string;
  notes: string[];
}

/** "woom-analytics_2026-10-01_2026-10-31.pdf" */
export function reportFileName(period: Period): string {
  return `woom-analytics_${period.from}_${period.to}.pdf`;
}

/** The moment the report was made, in the company's time (Prague). */
export function formatGeneratedAt(at: Date, language: Language): string {
  return dateFormat(INTL_LOCALES[language], {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: COMPANY_TIME_ZONE,
  }).format(at);
}

/**
 * Where a line may break inside a word: nowhere in an ordinary word, and
 * every few letters in one too long for a table cell (a listing's name
 * written without spaces must not run out of its column).
 */
export function splitLongWord(word: string): string[] {
  return pieces(word, LONG_WORD, WORD_PIECE);
}

/**
 * The same for a column heading, a cell a few figures wide: «Запланировано»
 * must break rather than run into the next column's heading.
 */
export function splitHeadingWord(word: string): string[] {
  return pieces(word, LONG_HEADING_WORD, HEADING_PIECE);
}

function pieces(word: string, longest: number, piece: number): string[] {
  if (word.length <= longest) {
    return [word];
  }
  const parts: string[] = [];
  for (let at = 0; at < word.length; at += piece) {
    parts.push(word.slice(at, at + piece));
  }
  return parts;
}

/** The filters in force, one line each, named as the page's chips name them. */
export function describeFilters(
  filters: AnalyticsFilters,
  lookups: ReportLookups,
  t: Translate,
): ReportFilterLine[] {
  const line = (label: string, values: readonly string[]): ReportFilterLine[] =>
    values.length === 0 ? [] : [{ label: t(`panel.analytics.filters.${label}`), value: values.join(', ') }];
  return [
    ...line('listings', filters.propertyIds.map((id) => listingFilterLabel(id, lookups.listingNames))),
    ...line(
      'people',
      filters.personIds.map((id) => personFilterLabel(id, lookups.people, lookups.staff, t)),
    ),
    ...line('cleaningStatus', filters.taskStatuses.map((status) => t(`panel.tasks.statuses.${status}`))),
    ...line('taskStatus', filters.problemStatuses.map((status) => t(`problems.statuses.${status}`))),
    ...line('urgency', filters.priorities.map((priority) => t(`problems.priorities.${priority}`))),
    ...(filters.hideArchived ? [{ label: t(`${PDF}archived`), value: t(`${PDF}archivedHidden`) }] : []),
  ];
}

/** The ten key figures, each beside its change when the period is compared. */
function kpis(input: ReportInput): KpiModel[] {
  const { summary, previousSummary, language, t } = input;
  return TILES.map((tile) => {
    const value = tile.value(summary);
    let change: string | null = null;
    let tone: Change['tone'] | null = null;
    if (previousSummary !== null) {
      const moved = changeOf(value, tile.value(previousSummary), tile.change, tile.better);
      if (moved === null) {
        change = t('panel.analytics.change.none');
      } else {
        const text = formatChange(moved, language);
        change = moved.kind === 'points' ? t('panel.analytics.change.points', { value: text }) : text;
        tone = moved.tone;
      }
    }
    return {
      key: tile.key,
      label: t(`${TILE_KEY}${tile.key}`),
      value: tile.show(value, language, t),
      change,
      tone,
      hint: tile.hint?.(summary, language, t) ?? null,
    };
  });
}

/** Two figures a day or a week, side by side; a chart of nothing says so instead. */
function columnChart(
  input: ReportInput,
  titleKey: string,
  names: readonly [string, string],
  colors: readonly [string, string],
  pick: (point: SeriesPoint) => [number, number],
): ColumnChartModel {
  const { t, language, bucket, series } = input;
  const title = `${t(`${CHARTS}${titleKey}`)} · ${t(`${CHARTS}${bucket === 'week' ? 'byWeek' : 'byDay'}`)}`;
  const legend = names.map((name, at) => ({ name: t(`${CHARTS}${name}`), color: colors[at] }));
  const values = series.map(pick);
  const max = Math.max(0, ...values.flat());
  if (max === 0) {
    return { title, legend, columns: [], top: 1, ticks: [], tickLabels: [], emptyText: t(`${CHARTS}empty`) };
  }
  const top = niceMax(max);
  const every = Math.max(1, Math.ceil(series.length / AXIS_LABELS));
  const axis = ticks(top);
  return {
    title,
    legend,
    columns: series.map((point, at) => ({
      key: point.bucket,
      label: formatShortDay(point.bucket, language),
      values: values[at],
      showLabel: at % every === 0,
    })),
    top,
    ticks: axis,
    tickLabels: axis.map((tick) => formatNumber(tick, language)),
    emptyText: null,
  };
}

/** A bar list's bars: the busiest, and after them the picks they leave out. */
interface BarSet {
  shown: readonly BarDatum[];
  picked: readonly BarDatum[];
}

/**
 * A bar list; one whose bars are all zero and none picked says so instead of
 * drawing them. A list is not filtered by its own bars (the page's
 * cross-filter), so the ones the page is filtered to are marked — and a pick
 * outside the busiest is added after them, as on the screen.
 */
function barChart(
  title: string,
  bars: BarSet,
  selected: readonly string[],
  notes: { busiest: string; withPicks: string } | null,
  emptyText: string,
): BarChartModel {
  const all = [...bars.shown, ...bars.picked];
  const items = all.some((bar) => bar.value > 0 || selected.includes(bar.id))
    ? all.map(({ id, label, value, valueText }) => ({ label, value, valueText, selected: selected.includes(id) }))
    : [];
  const note =
    notes === null || bars.shown.length < TOP_BARS ? null : bars.picked.length > 0 ? notes.withPicks : notes.busiest;
  return {
    title,
    color: REPORT_INK.primary,
    items,
    top: niceMax(Math.max(0, ...items.map((item) => item.value))),
    note: items.length === 0 ? null : note,
    emptyText: items.length === 0 ? emptyText : null,
  };
}

/**
 * The listing and cleaner bars with their picks. A pick's own row is in the
 * table the report reads with the page's filter, or among the busiest.
 */
function pickedBars(input: ReportInput): { byListing: BarSet; byCleaner: BarSet } {
  const { language, names, bars, filters, tables, lookups, t } = input;
  const listings = listingBars(bars.byListing, language);
  const cleaners = cleanerBars(bars.byCleaner, names, language);
  return {
    byListing: {
      shown: listings,
      picked: pickedListingBars(
        listings,
        filters.propertyIds,
        [...bars.byListing, ...tables.cleaningsByProperty],
        lookups.listingNames,
        language,
      ),
    },
    byCleaner: {
      shown: cleaners,
      picked: pickedCleanerBars(
        cleaners,
        filters.personIds,
        [...bars.byCleaner, ...tables.cleaningsByCleaner],
        names,
        lookups,
        t,
        language,
      ),
    },
  };
}

function charts(input: ReportInput): Pick<ReportModel, 'columnCharts' | 'barCharts'> {
  const { t, language, bars, filters } = input;
  const empty = t(`${CHARTS}empty`);
  const notes = {
    busiest: t(`${PDF}topBars`, { count: TOP_BARS }),
    withPicks: t(`${PDF}topBarsPicked`, { count: TOP_BARS }),
  };
  const picked = pickedBars(input);
  return {
    columnCharts: [
      columnChart(input, 'dynamics', ['done', 'checkouts'], [REPORT_INK.chart1, REPORT_INK.chart2], (point) => [
        point.cleanings_done,
        point.checkouts,
      ]),
      columnChart(input, 'problems', ['created', 'resolved'], [REPORT_INK.chart3, REPORT_INK.chart4], (point) => [
        point.problems_created,
        point.problems_resolved,
      ]),
    ],
    barCharts: [
      barChart(t(`${CHARTS}byListing`), picked.byListing, filters.propertyIds.map(String), notes, empty),
      barChart(t(`${CHARTS}byCleaner`), picked.byCleaner, filters.personIds, notes, empty),
      barChart(
        t(`${CHARTS}byUrgency`),
        { shown: urgencyBars(bars.urgency, t, language), picked: [] },
        filters.priorities,
        null,
        empty,
      ),
    ],
  };
}

/** A table as the page draws it: the same columns, every row. */
function table<T extends AnalyticsTable>(input: ReportInput, key: T): TableModel {
  const context: ColumnContext = { language: input.language, names: input.names, t: (k) => input.t(k) };
  const columns = COLUMNS[key] as readonly Column<AnalyticsRows[T]>[];
  const rows = input.tables[key] as readonly AnalyticsRows[T][];
  return {
    key,
    title: input.t(`panel.analytics.tables.${key}`),
    headers: columns.map((column) => input.t(column.header)),
    numeric: columns.map((column) => column.numeric),
    rows: rows.map((row) => columns.map((column) => column.text(row, context))),
    emptyText: rows.length === 0 ? input.t('panel.analytics.empty.table') : null,
  };
}

/**
 * Every text of the model as the font draws it (fitToFont): the names from
 * the data above all — a listing's emoji — and the words of Intl too.
 */
function fitted<T>(value: T): T {
  if (typeof value === 'string') {
    return fitToFont(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(fitted) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, fitted(one)])) as T;
  }
  return value;
}

export function buildReportModel(input: ReportInput): ReportModel {
  const { t, language, period, previous } = input;
  const title = `woom · ${t(`${PDF}title`)}`;
  const span = (of: Period) => ({ from: formatDay(of.from, language), to: formatDay(of.to, language) });
  const own = span(period);
  const empty = isEmptySummary(input.summary)
    ? { title: t('panel.analytics.empty.title'), body: t('panel.analytics.empty.body') }
    : null;
  const notes = ['done', 'checkout', 'cancelled', 'demo', ...(previous === null ? [] : ['change'])].map(
    (note) => t(`${PDF}notes.${note}`),
  );
  const content =
    empty === null
      ? { kpis: kpis(input), ...charts(input), tables: ANALYTICS_TABLES.map((key) => table(input, key)) }
      : { kpis: [], columnCharts: [], barCharts: [], tables: [] };
  const barListsStacked = content.barCharts.some((chart) => chart.items.length > BARS_SIDE_BY_SIDE);

  return fitted({
    language,
    title,
    runningHead: `${title} · ${own.from} – ${own.to}`,
    periodLine: t(`${PDF}period`, own),
    comparedLine: previous === null ? null : t('panel.analytics.period.comparedWith', span(previous)),
    filtersTitle: t('panel.analytics.filters.label'),
    filters: describeFilters(input.filters, input.lookups, t),
    noFiltersText: t(`${PDF}noFilters`),
    generatedLine: t(`${PDF}generated`, { date: formatGeneratedAt(input.generatedAt, language) }),
    pageText: (page, total) => fitToFont(t(`${PDF}page`, { page, total })),
    empty,
    kpiTitle: t(`${TILE_KEY}label`),
    chartsTitle: t(`${PDF}charts`),
    tablesTitle: t('panel.analytics.tables.label'),
    notesTitle: t(`${PDF}notesTitle`),
    notes,
    ...content,
    barListsStacked,
  });
}
