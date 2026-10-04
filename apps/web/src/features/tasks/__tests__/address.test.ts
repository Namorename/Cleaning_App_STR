import { describe, expect, test } from 'vitest';

import { DEFAULT_TASKS_ADDRESS, readTasksAddress, writeTasksAddress } from '../address';
import { EMPTY_FILTERS } from '../schema';

const MARIA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

const read = (query: string) => readTasksAddress(new URLSearchParams(query));

describe('the address of «Уборки»', () => {
  test('a bare address is today with no filters', () => {
    expect(read('')).toEqual({ tab: 'today', filters: EMPTY_FILTERS });
    expect(DEFAULT_TASKS_ADDRESS).toEqual({ tab: 'today', filters: EMPTY_FILTERS });
  });

  test('reads the tab and every filter', () => {
    expect(
      read(
        `tab=closed&q=vinohrady+2109&assignee=${MARIA}&type=inspection&from=2026-10-01&to=2026-10-07`,
      ),
    ).toEqual({
      tab: 'closed',
      filters: {
        query: 'vinohrady 2109',
        assigneeId: MARIA,
        type: 'inspection',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-07',
      },
    });
    expect(read('assignee=nobody').filters.assigneeId).toBe('nobody');
  });

  // A hand-edited or old link must open the screen, not break it.
  test('drops what it does not recognise, value by value', () => {
    expect(read('tab=archive&assignee=maria&type=repair&from=yesterday&to=2026-13&utm=x')).toEqual({
      tab: 'today',
      filters: EMPTY_FILTERS,
    });
  });

  test('writes only what differs from the defaults, in one order', () => {
    expect(writeTasksAddress(DEFAULT_TASKS_ADDRESS)).toBe('');
    expect(
      writeTasksAddress({
        tab: 'upcoming',
        filters: {
          query: 'vinohrady 2109',
          assigneeId: 'nobody',
          type: 'cleaning',
          dateFrom: '2026-10-01',
          dateTo: '',
        },
      }),
    ).toBe('tab=upcoming&q=vinohrady+2109&assignee=nobody&type=cleaning&from=2026-10-01');
  });

  test('a search of spaces only is no search', () => {
    expect(writeTasksAddress({ tab: 'today', filters: { ...EMPTY_FILTERS, query: '   ' } })).toBe(
      '',
    );
  });

  test('what it writes it reads back the same', () => {
    const address = {
      tab: 'closed' as const,
      filters: {
        query: 'Мойка окон & co',
        assigneeId: MARIA,
        type: 'midstay' as const,
        dateFrom: '',
        dateTo: '2026-10-31',
      },
    };

    expect(read(writeTasksAddress(address))).toEqual(address);
  });
});
