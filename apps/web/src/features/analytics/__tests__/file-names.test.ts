import { describe, expect, test } from 'vitest';

import { MAX_FILE_NAME, reportPdfName, slugOf, tableFileName, type FileNameScope } from '../file-names';
import { ANALYTICS_TABLES, NO_FILTERS, type AnalyticsFilters } from '../schema';

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const ANNA = '5e000000-0000-4000-8000-000000000001';
const EVA = '5e000000-0000-4000-8000-000000000004';
const NAMES: Record<number, string> = {
  7700006: 'Žižkov Attic',
  7700012: 'Vršovice ★ Cosy Room 🏠',
  7700020: 'Старый город',
  7700021: '🏠🏠',
};

function scope(overrides: Partial<AnalyticsFilters> = {}, period = OCTOBER): FileNameScope {
  return {
    period,
    filters: { ...NO_FILTERS, ...overrides },
    listingName: (id) => NAMES[id],
  };
}

const BACKSLASH = String.fromCharCode(92);
/** What Windows does not take in a file name, and the space. */
const NOT_FOR_WINDOWS = ['<', '>', ':', '"', '/', BACKSLASH, '|', '?', '*', ' '];

function isWindowsSafe(name: string): boolean {
  return [...name].every((sign) => sign.charCodeAt(0) >= 32 && !NOT_FOR_WINDOWS.includes(sign));
}

describe('the PDF report’s file name', () => {
  test('the report and its period, from and to', () => {
    expect(reportPdfName(scope())).toBe('woom-analytics-report_2026-10-01_to_2026-10-31.pdf');
  });

  test('a period of one day is one date', () => {
    expect(reportPdfName(scope({}, { from: '2026-10-13', to: '2026-10-13' }))).toBe(
      'woom-analytics-report_2026-10-13.pdf',
    );
  });

  test('a listing filter adds the listing, in Latin letters', () => {
    expect(reportPdfName(scope({ propertyIds: [7700006] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_property-zizkov-attic.pdf',
    );
    expect(reportPdfName(scope({ propertyIds: [7700020] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_property-staryy-gorod.pdf',
    );
    expect(reportPdfName(scope({ propertyIds: [7700012] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_property-vrsovice-cosy-room.pdf',
    );
  });

  test('a listing with no name to write is its number', () => {
    expect(reportPdfName(scope({ propertyIds: [7700021] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_property-7700021.pdf',
    );
    expect(reportPdfName(scope({ propertyIds: [404] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_property-404.pdf',
    );
  });

  test('several listings are counted, not named', () => {
    expect(reportPdfName(scope({ propertyIds: [7700006, 7700012, 7700020] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_properties-3.pdf',
    );
  });

  test('a person filter never names the person: a short id, or how many', () => {
    expect(reportPdfName(scope({ personIds: [EVA] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_person-5e000000.pdf',
    );
    expect(reportPdfName(scope({ personIds: [ANNA, EVA] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_people-2.pdf',
    );
  });

  test('a listing and a person: the listing first', () => {
    expect(reportPdfName(scope({ propertyIds: [7700006], personIds: [EVA] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_property-zizkov-attic_person-5e000000.pdf',
    );
  });

  test('the other filters do not change the name', () => {
    expect(reportPdfName(scope({ priorities: ['high'], taskStatuses: ['done'], hideArchived: true }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31.pdf',
    );
  });
});

describe('the table files’ names', () => {
  test.each([
    ['cleaningsByProperty', 'cleanings-by-property'],
    ['cleaningsByCleaner', 'cleanings-by-cleaner'],
    ['problemsByProperty', 'tasks-by-property'],
    ['problemsByTechnician', 'tasks-by-technician'],
    ['checkoutsByProperty', 'checkouts-by-property'],
  ] as const)('%s is %s', (table, name) => {
    expect(tableFileName(table, scope(), 'csv')).toBe(`woom-analytics_${name}_2026-10-01_to_2026-10-31.csv`);
    expect(tableFileName(table, scope(), 'xlsx')).toBe(`woom-analytics_${name}_2026-10-01_to_2026-10-31.xlsx`);
  });

  test('the same period and filter rule as the PDF', () => {
    const oneDay = scope({ personIds: [EVA] }, { from: '2026-10-13', to: '2026-10-13' });
    expect(tableFileName('cleaningsByCleaner', oneDay, 'csv')).toBe(
      'woom-analytics_cleanings-by-cleaner_2026-10-13_person-5e000000.csv',
    );
    expect(tableFileName('problemsByProperty', scope({ propertyIds: [7700006] }), 'xlsx')).toBe(
      'woom-analytics_tasks-by-property_2026-10-01_to_2026-10-31_property-zizkov-attic.xlsx',
    );
  });
});

describe('every name is safe to keep', () => {
  const nasty = `Apartmán <Na> "Náplavce": a/b${BACKSLASH}c|d?e*f — ${'x'.repeat(200)}`;
  const withNasty: FileNameScope = { ...scope({ propertyIds: [1], personIds: [EVA] }), listingName: () => nasty };
  const names = [
    ...ANALYTICS_TABLES.flatMap((table) => [
      tableFileName(table, withNasty, 'xlsx'),
      tableFileName(table, scope({ propertyIds: [7700020] }), 'csv'),
    ]),
    reportPdfName(withNasty),
    reportPdfName(scope({ propertyIds: [7700012], personIds: [ANNA, EVA] })),
  ];

  test.each(names)('%s', (name) => {
    expect(isWindowsSafe(name)).toBe(true);
    expect(name).toMatch(/^[a-z0-9._-]+$/);
    expect(name.length).toBeLessThanOrEqual(MAX_FILE_NAME);
  });

  test('reasonable means at most 120 signs', () => {
    expect(MAX_FILE_NAME).toBe(120);
  });

  test('a long listing name is cut; the period, the person and the extension stay', () => {
    expect(reportPdfName(withNasty)).toMatch(
      /^woom-analytics-report_2026-10-01_to_2026-10-31_property-apartman-na-naplavce-a-b-c-d-e-f-x+_person-5e000000\.pdf$/,
    );
    expect(tableFileName('cleaningsByProperty', withNasty, 'xlsx')).toMatch(
      /^woom-analytics_cleanings-by-property_2026-10-01_to_2026-10-31_property-apartman[a-z-]*_person-5e000000\.xlsx$/,
    );
  });
});

describe('the cut and the id', () => {
  test('a name cut on a word break ends on a letter, not a hyphen', () => {
    // Room for the listing here is 44 signs: the 44th is the space between the words.
    const name = reportPdfName({
      ...scope({ propertyIds: [1], personIds: [EVA] }),
      listingName: () => `${'a'.repeat(43)} ${'b'.repeat(20)}`,
    });
    expect(name).toBe(`woom-analytics-report_2026-10-01_to_2026-10-31_property-${'a'.repeat(43)}_person-5e000000.pdf`);
  });

  test('a person id written in capitals is written small', () => {
    expect(reportPdfName(scope({ personIds: ['5E00ABCD-0000-4000-8000-000000000004'] }))).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_person-5e00abcd.pdf',
    );
  });
});

describe('slugOf', () => {
  test('a letter stored as a base and a mark is read as the one letter', () => {
    const shortI = `и${String.fromCharCode(0x306)}`;
    expect(slugOf(`Стары${shortI} город`)).toBe('staryy-gorod');
  });

  test('Latin letters, digits and single hyphens, whatever the language', () => {
    expect(slugOf('Malá Strana Suite')).toBe('mala-strana-suite');
    expect(slugOf('Straße am Fluss')).toBe('strasse-am-fluss');
    expect(slugOf('Квартира №5, Алматы')).toBe('kvartira-5-almaty');
    expect(slugOf('  --Loft--  ')).toBe('loft');
    expect(slugOf('🏠')).toBe('');
  });
});
