import { describe, expect, test } from 'vitest';

import { i18n } from '@/lib/i18n';

import { NO_FILTERS } from '../../schema';
import {
  buildReportModel,
  describeFilters,
  formatGeneratedAt,
  reportFileName,
  splitHeadingWord,
  splitLongWord,
} from '../report-model';
import { ANNA, days, EMPTY, GONE, LOOKUPS, reportInput as input } from './fixtures';

describe('the file and the moment', () => {
  test('the file is named after the period', () => {
    expect(reportFileName({ from: '2026-10-01', to: '2026-10-31' })).toBe(
      'woom-analytics_2026-10-01_2026-10-31.pdf',
    );
  });

  test('the moment of making is told in Prague time, summer or winter', () => {
    expect(formatGeneratedAt(new Date('2026-10-15T18:41:00Z'), 'en')).toBe('15 Oct 2026, 20:41');
    expect(formatGeneratedAt(new Date('2026-12-01T12:05:00Z'), 'en')).toBe('1 Dec 2026, 13:05');
    expect(formatGeneratedAt(new Date('2026-10-15T18:41:00Z'), 'ru')).toContain('20:41');
  });
});

describe('splitLongWord', () => {
  test('an ordinary word stays whole: no hyphen is added inside it', () => {
    expect(splitLongWord('Apartment')).toEqual(['Apartment']);
    expect(splitLongWord('Přízemní')).toEqual(['Přízemní']);
  });

  test('a column heading may break inside a word the narrow column cannot hold', () => {
    expect(splitHeadingWord('Done')).toEqual(['Done']);
    const parts = splitHeadingWord('Запланировано');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe('Запланировано');
    expect(parts.every((part) => part.length <= 4)).toBe(true);
  });

  test('a word too long for a cell is cut into pieces the line may break between', () => {
    const word = 'Riversideapartmentnumberseventeenwithgarden';
    const parts = splitLongWord(word);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(word);
    expect(parts.every((part) => part.length <= 12)).toBe(true);
  });
});

describe('describeFilters', () => {
  test('no filter, no lines', () => {
    expect(describeFilters(NO_FILTERS, LOOKUPS, i18n.getFixedT('en'))).toEqual([]);
  });

  test('every filter in force, named as the chips name it', () => {
    const lines = describeFilters(
      {
        propertyIds: [2, 1, 99],
        personIds: [ANNA, GONE],
        taskStatuses: ['done', 'expired'],
        problemStatuses: ['open'],
        priorities: ['high'],
        hideArchived: true,
      },
      LOOKUPS,
      i18n.getFixedT('en'),
    );
    expect(lines).toEqual([
      { label: 'Listings', value: 'Gone flat (archived), Old Town flat, 99' },
      { label: 'People', value: 'Anna Novak, Former employee' },
      { label: 'Cleaning status', value: 'Done, Expired' },
      { label: 'Task status', value: 'Open' },
      { label: 'Urgency', value: 'High' },
      { label: 'Archived listings', value: 'hidden' },
    ]);
  });
});

describe('buildReportModel', () => {
  test('the head: title, period, comparison, filters, the moment and the pages', () => {
    const model = buildReportModel(input('en', { filters: { ...NO_FILTERS, priorities: ['high'] } }));
    expect(model.title).toBe('woom · Analytics report');
    expect(model.periodLine).toBe('Period: 1 Oct 2026 – 31 Oct 2026');
    expect(model.comparedLine).toBe('Compared with 1 Sept 2026 – 30 Sept 2026');
    expect(model.filters).toEqual([{ label: 'Urgency', value: 'High' }]);
    expect(model.generatedLine).toBe('Generated 15 Oct 2026, 20:41, Prague time');
    expect(model.pageText(2, 5)).toBe('Page 2 of 5');
    expect(model.runningHead).toBe('woom · Analytics report · 1 Oct 2026 – 31 Oct 2026');
  });

  test('without a comparison: no line for it and no changes on the figures', () => {
    const model = buildReportModel(input('en', { previous: null, previousSummary: null }));
    expect(model.comparedLine).toBeNull();
    expect(model.kpis.every((kpi) => kpi.change === null)).toBe(true);
  });

  test('the ten key figures, the cancelled tasks among them, with their change', () => {
    const model = buildReportModel(input('en'));
    expect(model.kpis.map((kpi) => kpi.label)).toEqual([
      'Cleanings done',
      'Cleanings planned',
      'Checkouts',
      'Tasks resolved',
      'Tasks open',
      'Tasks cancelled',
      'Average urgency',
      'Median cleaning time',
      'Cleanings with photos',
      'Occupancy',
    ]);
    const done = model.kpis[0];
    expect(done.value).toBe('5');
    expect(done.change).toBe('+25%');
    expect(done.tone).toBe('good');
    expect(done.hint).toBe('by the day they were finished · of them mid-stay: 1');
    expect(model.kpis[5].value).toBe('1');
    expect(model.kpis[7].value).toBe('75 min');
    expect(model.kpis[9].value).toBe('15%');
    expect(model.kpis[9].change).toBe('0 pp');
  });

  test('the charts: two series with thinned day labels, three bar lists', () => {
    const model = buildReportModel(input('en'));
    expect(model.columnCharts.map((chart) => chart.title)).toEqual([
      'Cleanings and checkouts · By day',
      'Tasks created and resolved · By day',
    ]);
    const [cleanings] = model.columnCharts;
    expect(cleanings.legend.map((item) => item.name)).toEqual(['Cleanings done', 'Checkouts']);
    expect(cleanings.columns).toHaveLength(31);
    expect(cleanings.columns[0]).toMatchObject({ label: '01/10', values: [0, 0], showLabel: true });
    const shown = cleanings.columns.filter((column) => column.showLabel).length;
    expect(shown).toBeGreaterThan(3);
    expect(shown).toBeLessThanOrEqual(11);
    expect(cleanings.top).toBe(2);
    expect(cleanings.emptyText).toBeNull();

    expect(model.barCharts.map((chart) => chart.title)).toEqual([
      'Cleanings done by listing',
      'Cleanings done by cleaner',
      'Tasks created by urgency',
    ]);
    expect(model.barCharts[0].items).toEqual([
      { label: 'Old Town flat', value: 3, valueText: '3', selected: false },
    ]);
    expect(model.barCharts[2].items.map((item) => item.label)).toEqual(['Low', 'Normal', 'High']);
  });

  test('the bars the page is filtered to are marked, as the screen marks them', () => {
    const model = buildReportModel(
      input('en', { filters: { ...NO_FILTERS, personIds: [ANNA], priorities: ['high'] } }),
    );
    expect(model.barCharts[0].items.map((item) => item.selected)).toEqual([false]);
    expect(model.barCharts[1].items.map((item) => item.selected)).toEqual([true]);
    expect(model.barCharts[2].items.map((item) => item.selected)).toEqual([false, false, true]);
  });

  test('a series with nothing in it says so instead of drawing empty columns', () => {
    const quiet = days(7).map((point) => ({
      ...point,
      cleanings_done: 0,
      checkouts: 0,
      problems_created: 0,
      problems_resolved: 0,
    }));
    const model = buildReportModel(input('en', { series: quiet }));
    expect(model.columnCharts[0].columns).toEqual([]);
    expect(model.columnCharts[0].emptyText).toBe('Nothing to draw for this period');
  });

  test('the five tables, every row, the empty ones said so', () => {
    const model = buildReportModel(input('en'));
    expect(model.tables.map((table) => table.title)).toEqual([
      'Cleanings by listing',
      'Cleanings by cleaner',
      'Checkouts by listing',
      'Tasks by listing',
      'Tasks by technician',
    ]);
    const [byListing, , checkouts, tasks] = model.tables;
    expect(byListing.headers[0]).toBe('Listing');
    expect(byListing.numeric).toEqual([false, true, true, true, true, true, true, true]);
    expect(byListing.rows).toEqual([['Old Town flat', '4', '3', '1', '1', '0', '45', '50%']]);
    expect(checkouts.rows).toEqual([]);
    expect(checkouts.emptyText).toBe('No rows for this period');
    expect(tasks.rows[0][0]).toBe('No listing');
  });

  test('names as the page shows them: initials in the tables and the bars', () => {
    const model = buildReportModel(input('en', { names: 'initials' }));
    expect(model.tables[1].rows[0][0]).toBe('A. N.');
    expect(model.barCharts[1].items[0].label).toBe('A. N.');
  });

  test('an empty period is one calm message: no figures, charts or tables', () => {
    const model = buildReportModel(input('en', { summary: EMPTY, previousSummary: EMPTY }));
    expect(model.empty).toEqual({
      title: 'Nothing to count in this period',
      body: 'Figures appear as cleanings, checkouts and tasks are recorded. The history starts with the launch of the app.',
    });
    expect(model.kpis).toEqual([]);
    expect(model.columnCharts).toEqual([]);
    expect(model.barCharts).toEqual([]);
    expect(model.tables).toEqual([]);
    expect(model.notes.length).toBeGreaterThan(0);
  });

  test('the notes say how the figures are counted', () => {
    const model = buildReportModel(input('en'));
    expect(model.notesTitle).toBe('How the figures are counted');
    expect(model.notes.length).toBeGreaterThanOrEqual(4);
    expect(model.notes.join(' ')).toContain('time zone');
  });

  test.each(['en', 'cs', 'ru'] as const)('every text is translated in %s', (language) => {
    const model = buildReportModel(
      input(language, { filters: { ...NO_FILTERS, priorities: ['high'], hideArchived: true } }),
    );
    const texts = [
      model.title,
      model.periodLine,
      model.comparedLine ?? '',
      model.generatedLine,
      model.pageText(1, 2),
      model.runningHead,
      model.filtersTitle,
      model.noFiltersText,
      model.kpiTitle,
      model.chartsTitle,
      model.tablesTitle,
      model.notesTitle,
      ...model.filters.flatMap((line) => [line.label, line.value]),
      ...model.kpis.flatMap((kpi) => [kpi.label, kpi.value, kpi.change ?? '', kpi.hint ?? '']),
      ...model.columnCharts.flatMap((chart) => [chart.title, ...chart.legend.map((item) => item.name)]),
      ...model.barCharts.flatMap((chart) => [chart.title, chart.note ?? '']),
      ...model.tables.flatMap((table) => [table.title, ...table.headers]),
      ...model.notes,
    ];
    expect(texts.filter((text) => /panel\.|problems\.|\{\{/.test(text))).toEqual([]);
    if (language !== 'en') {
      expect(model.title).not.toBe('woom · Analytics report');
    }
  });
});
