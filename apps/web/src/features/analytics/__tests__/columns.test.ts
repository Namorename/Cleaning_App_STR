import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n';

import { COLUMNS, exportRows, type ColumnContext } from '../columns';

describe('the technicians table', () => {
  // repairs_open is counted now, not at the end of the period (owner, 2026-10-15).
  it('says its open repairs are the ones open now, in every language', () => {
    const header = (language: string) => i18n.getFixedT(language)('panel.analytics.columns.repairsOpen');
    expect([header('en'), header('cs'), header('ru')]).toEqual([
      'Open now',
      'Nyní otevřeno',
      'Сейчас открыто',
    ]);
  });
});

const context = (names: ColumnContext['names'] = 'full'): ColumnContext => ({
  language: 'en',
  names,
  t: (key: string) => key,
});

describe('exportRows', () => {
  it('heads the table with the translated column names and keeps numbers numbers', () => {
    const rows = exportRows(
      'cleaningsByCleaner',
      [
        {
          person_id: 'a',
          full_name: 'Anna Novak',
          done: 4,
          done_midstay: 1,
          planned: 4,
          minutes_median: 60,
          minutes_avg: 70,
          photo_share: 0.25,
          listings: 2,
          total_count: 1,
        },
      ],
      context(),
    );
    expect(rows[0]).toEqual(COLUMNS.cleaningsByCleaner.map((column) => column.header));
    expect(rows[1]).toEqual(['Anna Novak', 4, 1, 4, 70, 25, 2]);
  });

  it('writes names as initials when the page is set to', () => {
    const rows = exportRows(
      'problemsByTechnician',
      [
        {
          person_id: 't',
          full_name: 'Tomas Dvorak',
          repairs_done: 2,
          repairs_open: 0,
          problems_resolved: 2,
          work_minutes_avg: 45,
          hours_to_resolve_avg: null,
          total_count: 1,
        },
      ],
      context('initials'),
    );
    expect(rows[1]).toEqual(['T. D.', 2, 0, 2, 45, null]);
  });

  it('names a task with no listing, and leaves an uncounted figure empty', () => {
    const rows = exportRows(
      'problemsByProperty',
      [
        {
          listing_id: null,
          listing_name: null,
          created: 0,
          resolved: 1,
          open_end: 0,
          urgency_avg: null,
          hours_to_resolve_avg: 336,
          total_count: 1,
        },
      ],
      context(),
    );
    expect(rows[1]).toEqual(['panel.analytics.columns.noListing', 0, 1, 0, null, 336]);
  });
});

describe('the screen cells', () => {
  it('formats shares as percentages and means with a decimal', () => {
    const [listing, , , , , , minutes, photos] = COLUMNS.cleaningsByProperty;
    const row = {
      listing_id: 1,
      listing_name: 'Flat',
      planned: 4,
      done: 3,
      done_midstay: 1,
      expired: 1,
      cancelled: 1,
      minutes_median: 45,
      minutes_avg: 45.25,
      photo_share: 0.3333,
      total_count: 1,
    };
    expect(listing.text(row, context())).toBe('Flat');
    expect(minutes.text(row, context())).toBe('45.3');
    expect(photos.text(row, context())).toBe('33.3%');
  });
});
