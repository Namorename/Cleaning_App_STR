import { Document, Line, Page, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';

import { share } from '../charts/geometry';
import { REPORT_FONT } from './fonts';
import {
  REPORT_INK as INK,
  splitHeadingWord,
  type BarChartModel,
  type BarModel,
  type ColumnChartModel,
  type KpiModel,
  type ReportModel,
  type TableModel,
} from './report-model';

/** A4 in points, its margins, and the width left for the report. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
/** The running head and the foot sit this far from the page's edge. */
const EDGE = 22;
const FOOT_HEIGHT = 10;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const CARD_PADDING = 8;
/** A column chart: its height, and the gutter its axis figures stand in. */
const CHART_HEIGHT = 110;
const AXIS_GUTTER = 24;
/** The first column of a table holds a name: it gets more room than a figure. */
const FIRST_COLUMN_SHARE = 0.3;
/** Room a table needs at a page's foot to begin there: its header row and a first row. */
const TABLE_START = 70;
/** A table this short moves to the next page whole, its title with it; a longer one runs on. */
const KEEP_TOGETHER_ROWS = 25;

const styles = StyleSheet.create({
  page: {
    fontFamily: REPORT_FONT,
    fontWeight: 600,
    fontSize: 9,
    color: INK.text,
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: MARGIN,
  },
  runningHead: { position: 'absolute', top: EDGE, left: MARGIN, right: MARGIN, fontSize: 7.5, color: INK.muted },
  // The foot is measured from the top too: a fixed text placed from the
  // bottom edge was not drawn at all.
  footLeft: {
    position: 'absolute',
    top: PAGE_HEIGHT - EDGE - FOOT_HEIGHT,
    left: MARGIN,
    fontSize: 7.5,
    color: INK.muted,
  },
  footRight: {
    position: 'absolute',
    top: PAGE_HEIGHT - EDGE - FOOT_HEIGHT,
    right: MARGIN,
    fontSize: 7.5,
    color: INK.muted,
    textAlign: 'right',
  },
  title: { fontSize: 18, fontWeight: 800, color: INK.primary, marginBottom: 4 },
  period: { fontSize: 11, fontWeight: 700 },
  muted: { color: INK.muted },
  bold: { fontWeight: 700 },
  filters: { backgroundColor: INK.surfaceAlt, borderRadius: 6, padding: CARD_PADDING, marginTop: 10 },
  filtersTitle: { fontSize: 8, fontWeight: 800, marginBottom: 2 },
  section: { fontSize: 12, fontWeight: 800, marginTop: 16, marginBottom: 6 },
  empty: { borderWidth: 1, borderColor: INK.primary, borderRadius: 6, padding: 14, marginTop: 16 },
  emptyTitle: { fontSize: 13, fontWeight: 800, marginBottom: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: {
    width: '32.5%',
    borderWidth: 1,
    borderColor: INK.divider,
    borderRadius: 6,
    padding: CARD_PADDING,
    marginBottom: 6,
  },
  tileLabel: { fontSize: 8, color: INK.muted },
  tileValue: { fontSize: 16, fontWeight: 800, marginTop: 2 },
  tileChange: { fontSize: 8, fontWeight: 700 },
  tileHint: { fontSize: 7, color: INK.muted, marginTop: 2 },
  card: { borderWidth: 1, borderColor: INK.divider, borderRadius: 6, padding: CARD_PADDING, marginBottom: 8 },
  cardTitle: { fontSize: 9.5, fontWeight: 800, marginBottom: 4 },
  legend: { flexDirection: 'row', marginBottom: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12, fontSize: 7.5 },
  // An edge, as the page draws: the light yellow alone hardly shows on white.
  swatch: { width: 8, height: 8, borderRadius: 2, marginRight: 4, borderWidth: 0.5, borderColor: INK.muted },
  axisText: { position: 'absolute', fontSize: 6.5, color: INK.muted },
  bars: { flexDirection: 'row', justifyContent: 'space-between' },
  barCard: { width: '32.5%' },
  barRow: { marginBottom: 4 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5 },
  barLabel: { flex: 1, marginRight: 4, maxLines: 2, textOverflow: 'ellipsis' },
  barValue: { fontWeight: 800 },
  barSelected: { fontWeight: 800, color: INK.primary },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: INK.surfaceAlt, marginTop: 1 },
  tiny: { fontSize: 7, color: INK.muted, marginTop: 4 },
  tableTitle: { fontSize: 10, fontWeight: 800, marginTop: 10, marginBottom: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: INK.divider },
  headerRow: { backgroundColor: INK.divider, borderBottomWidth: 1, borderBottomColor: INK.muted },
  zebra: { backgroundColor: INK.surfaceAlt },
  cell: { fontSize: 7.5, paddingVertical: 3, paddingHorizontal: 3 },
  headerCell: { fontWeight: 800 },
  numeric: { textAlign: 'right' },
  note: { flexDirection: 'row', marginBottom: 2 },
  noteDash: { width: 8 },
  noteText: { flex: 1 },
});

function toneColor(tone: KpiModel['tone']): string {
  if (tone === 'good') {
    return INK.good;
  }
  if (tone === 'bad') {
    return INK.bad;
  }
  return INK.muted;
}

function Head({ model }: { model: ReportModel }) {
  return (
    <View>
      <Text style={styles.title}>{model.title}</Text>
      <Text style={styles.period}>{model.periodLine}</Text>
      {model.comparedLine === null ? null : <Text style={styles.muted}>{model.comparedLine}</Text>}
      <View style={styles.filters} wrap={false}>
        <Text style={styles.filtersTitle}>{model.filtersTitle}</Text>
        {model.filters.length === 0 ? (
          <Text>{model.noFiltersText}</Text>
        ) : (
          model.filters.map((line) => (
            <Text key={line.label}>
              <Text style={styles.bold}>{line.label}: </Text>
              {line.value}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

function Tiles({ model }: { model: ReportModel }) {
  return (
    <View>
      <Text style={styles.section} minPresenceAhead={80}>
        {model.kpiTitle}
      </Text>
      <View style={styles.tiles}>
        {model.kpis.map((kpi) => (
          <View key={kpi.key} style={styles.tile} wrap={false}>
            <Text style={styles.tileLabel}>{kpi.label}</Text>
            <Text style={styles.tileValue}>{kpi.value}</Text>
            {kpi.change === null ? null : (
              <Text style={[styles.tileChange, { color: toneColor(kpi.tone) }]}>{kpi.change}</Text>
            )}
            {kpi.hint === null ? null : <Text style={styles.tileHint}>{kpi.hint}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

function Legend({ chart }: { chart: ColumnChartModel }) {
  return (
    <View style={styles.legend}>
      {chart.legend.map((item) => (
        <View key={item.name} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: item.color }]} />
          <Text>{item.name}</Text>
        </View>
      ))}
    </View>
  );
}

/** Columns two by two, a day or a week apiece, on the same scale as the page's. */
function ColumnChartView({ chart }: { chart: ColumnChartModel }) {
  const width = CONTENT_WIDTH - 2 * CARD_PADDING;
  const slot = (width - AXIS_GUTTER) / Math.max(1, chart.columns.length);
  const bar = Math.max(0.6, Math.min(10, (slot * 0.8) / 2));
  const y = (value: number) => CHART_HEIGHT - share(value, chart.top) * CHART_HEIGHT;
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.cardTitle}>{chart.title}</Text>
      {chart.emptyText !== null ? (
        <Text style={styles.muted}>{chart.emptyText}</Text>
      ) : (
        <View>
          <Legend chart={chart} />
          <View style={{ height: CHART_HEIGHT + 12 }}>
            <Svg width={width} height={CHART_HEIGHT + 1} style={{ position: 'absolute', top: 0, left: 0 }}>
              {chart.ticks.map((tick) => (
                <Line
                  key={`tick-${tick}`}
                  x1={AXIS_GUTTER}
                  x2={width}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={INK.divider}
                  strokeWidth={0.6}
                />
              ))}
              {chart.columns.flatMap((column, at) =>
                column.values.map((value, series) => {
                  const height = share(value, chart.top) * CHART_HEIGHT;
                  return height === 0 ? null : (
                    <Rect
                      key={`${column.key}-${series}`}
                      x={AXIS_GUTTER + at * slot + (slot - 2 * bar) / 2 + series * bar}
                      y={CHART_HEIGHT - height}
                      width={bar}
                      height={height}
                      fill={chart.legend[series].color}
                      stroke={INK.muted}
                      strokeWidth={0.4}
                    />
                  );
                }),
              )}
            </Svg>
            {chart.ticks.map((tick, at) => (
              <Text
                key={`label-${tick}`}
                style={[styles.axisText, { left: 0, width: AXIS_GUTTER - 4, top: y(tick) - 4, textAlign: 'right' }]}
              >
                {chart.tickLabels[at]}
              </Text>
            ))}
            {chart.columns.map((column, at) =>
              column.showLabel ? (
                <Text
                  key={`day-${column.key}`}
                  style={[
                    styles.axisText,
                    { top: CHART_HEIGHT + 2, left: AXIS_GUTTER + at * slot + slot / 2 - 16, width: 32, textAlign: 'center' },
                  ]}
                >
                  {column.label}
                </Text>
              ) : null,
            )}
          </View>
        </View>
      )}
    </View>
  );
}

/** One bar: its name and figure, and the bar under them, never cut in two. */
function BarRow({ item, chart, anySelected }: { item: BarModel; chart: BarChartModel; anySelected: boolean }) {
  return (
    <View style={styles.barRow} wrap={false}>
      <View style={styles.barHead}>
        <Text style={[styles.barLabel, item.selected ? styles.barSelected : {}]}>{item.label}</Text>
        <Text style={styles.barValue}>{item.valueText}</Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={{
            height: 4,
            borderRadius: 2,
            width: `${share(item.value, chart.top) * 100}%`,
            backgroundColor: anySelected && !item.selected ? INK.divider : chart.color,
          }}
        />
      </View>
    </View>
  );
}

/**
 * Bars a line each; the ones the page is filtered to marked, the rest dimmed,
 * as on the screen. A list of the whole width (`isWide`) may run on over the
 * pages: its title is kept with its first bar (minPresenceAhead does not hold
 * a card's first child), and a bar is never cut in two.
 */
function BarChartView({ chart, isWide }: { chart: BarChartModel; isWide: boolean }) {
  const anySelected = chart.items.some((item) => item.selected);
  const [first, ...rest] = chart.items;
  const title = <Text style={styles.cardTitle}>{chart.title}</Text>;
  return (
    <View style={isWide ? styles.card : [styles.card, styles.barCard]}>
      {chart.emptyText !== null || first === undefined ? (
        <View wrap={false}>
          {title}
          <Text style={styles.muted}>{chart.emptyText}</Text>
        </View>
      ) : (
        <>
          <View wrap={false}>
            {title}
            <BarRow item={first} chart={chart} anySelected={anySelected} />
          </View>
          {rest.map((item, at) => (
            <BarRow key={`${item.label}-${at}`} item={item} chart={chart} anySelected={anySelected} />
          ))}
        </>
      )}
      {chart.note === null ? null : <Text style={styles.tiny}>{chart.note}</Text>}
    </View>
  );
}

function Charts({ model }: { model: ReportModel }) {
  return (
    <View>
      <Text style={styles.section} minPresenceAhead={160}>
        {model.chartsTitle}
      </Text>
      {model.columnCharts.map((chart) => (
        <ColumnChartView key={chart.title} chart={chart} />
      ))}
      {model.barListsStacked ? (
        model.barCharts.map((chart) => <BarChartView key={chart.title} chart={chart} isWide />)
      ) : (
        <View style={styles.bars} wrap={false}>
          {model.barCharts.map((chart) => (
            <BarChartView key={chart.title} chart={chart} isWide={false} />
          ))}
        </View>
      )}
    </View>
  );
}

/** The share of the width each column of a table gets: the name wider, the figures even. */
export function columnWidths(count: number): string[] {
  const rest = count <= 1 ? 0 : (1 - FIRST_COLUMN_SHARE) / (count - 1);
  return Array.from({ length: count }, (_, at) =>
    `${((at === 0 ? (count <= 1 ? 1 : FIRST_COLUMN_SHARE) : rest) * 100).toFixed(3)}%`,
  );
}

/** A table that runs on over the pages, its header row on each of them. */
function TableView({ table }: { table: TableModel }) {
  const widths = columnWidths(table.headers.length);
  const align = (at: number) => (table.numeric[at] ? styles.numeric : {});
  // minPresenceAhead alone left a title at a page's foot: a short table is kept whole.
  return (
    <View wrap={table.rows.length > KEEP_TOGETHER_ROWS}>
      {/* The title goes with its header row and a first row, never alone at a page's foot. */}
      <Text style={styles.tableTitle} minPresenceAhead={TABLE_START}>
        {table.title}
      </Text>
      {table.emptyText !== null ? (
        <Text style={styles.muted}>{table.emptyText}</Text>
      ) : (
        <View>
          <View style={[styles.row, styles.headerRow]} fixed>
            {table.headers.map((header, at) => (
              <Text
                key={header}
                style={[styles.cell, styles.headerCell, { width: widths[at] }, align(at)]}
                hyphenationCallback={splitHeadingWord}
              >
                {header}
              </Text>
            ))}
          </View>
          {table.rows.map((row, index) => (
            <View key={`${table.key}-${index}`} style={[styles.row, index % 2 === 1 ? styles.zebra : {}]} wrap={false}>
              {row.map((cell, at) => (
                <Text key={`${table.key}-${index}-${at}`} style={[styles.cell, { width: widths[at] }, align(at)]}>
                  {cell}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Notes({ model }: { model: ReportModel }) {
  return (
    <View wrap={false}>
      <Text style={styles.section}>{model.notesTitle}</Text>
      {model.notes.map((note) => (
        <View key={note} style={styles.note}>
          <Text style={styles.noteDash}>–</Text>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ))}
    </View>
  );
}

/** The Analytics report: A4 portrait, as many pages as its tables need. */
export function ReportDocument({ model }: { model: ReportModel }) {
  return (
    <Document title={model.title} author="woom" creator="woom" producer="woom" language={model.language}>
      <Page size="A4" orientation="portrait" style={styles.page} wrap>
        <Text
          style={styles.runningHead}
          fixed
          render={({ pageNumber }) => (pageNumber > 1 ? model.runningHead : '')}
        />
        <Head model={model} />
        {model.empty === null ? (
          <View>
            <Tiles model={model} />
            <Charts model={model} />
            <Text style={styles.section} minPresenceAhead={80}>
              {model.tablesTitle}
            </Text>
            {model.tables.map((table) => (
              <TableView key={table.key} table={table} />
            ))}
          </View>
        ) : (
          <View style={styles.empty} wrap={false}>
            <Text style={styles.emptyTitle}>{model.empty.title}</Text>
            <Text>{model.empty.body}</Text>
          </View>
        )}
        <Notes model={model} />
        <Text style={styles.footLeft} fixed>
          {model.generatedLine}
        </Text>
        <Text
          style={styles.footRight}
          fixed
          render={({ pageNumber, totalPages }) => model.pageText(pageNumber, totalPages)}
        />
      </Page>
    </Document>
  );
}
