import { describe, expect, test } from 'vitest';

import { withDayHeadings, type DayEntry } from '../day-entries';

interface Row {
  id: string;
  day: string;
  part?: string;
}

const dayOf = (row: Row) => row.day;
const partOf = (row: Row) => row.part ?? '';

/** The entries as one line each: «# day» for a heading, the id for an item. */
const lines = (entries: DayEntry<Row>[]) =>
  entries.map((entry) => (entry.kind === 'day' ? `# ${entry.day}` : entry.item.id));

describe('withDayHeadings', () => {
  test('heads the first item of each new day, the first day too, and moves nothing', () => {
    const rows: Row[] = [
      { id: 'a', day: '2026-11-26' },
      { id: 'b', day: '2026-11-27' },
      { id: 'c', day: '2026-11-27' },
      { id: 'd', day: '2026-11-29' },
    ];

    expect(lines(withDayHeadings(rows, dayOf))).toEqual([
      '# 2026-11-26',
      'a',
      '# 2026-11-27',
      'b',
      'c',
      '# 2026-11-29',
      'd',
    ]);
  });

  test('an empty list has no headings', () => {
    expect(withDayHeadings([], dayOf)).toEqual([]);
  });

  test('a heading knows its day’s first item', () => {
    const rows: Row[] = [
      { id: 'a', day: '2026-11-27' },
      { id: 'b', day: '2026-11-27' },
    ];

    const [heading] = withDayHeadings(rows, dayOf);
    expect(heading).toMatchObject({ kind: 'day', day: '2026-11-27', first: rows[0] });
  });

  test('a new part starts its days afresh, even on the day the last part ended on', () => {
    const rows: Row[] = [
      { id: 'live', day: '2026-11-27', part: 'live' },
      { id: 'closed', day: '2026-11-27', part: 'closed' },
    ];

    expect(lines(withDayHeadings(rows, dayOf, partOf))).toEqual([
      '# 2026-11-27',
      'live',
      '# 2026-11-27',
      'closed',
    ]);
  });

  test('every heading’s key is its own, though a list out of order comes back to a day', () => {
    const rows: Row[] = [
      { id: 'a', day: '2026-11-27' },
      { id: 'b', day: '2026-11-28' },
      { id: 'c', day: '2026-11-27' },
    ];

    const keys = withDayHeadings(rows, dayOf).flatMap((entry) =>
      entry.kind === 'day' ? [entry.key] : [],
    );
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });
});
