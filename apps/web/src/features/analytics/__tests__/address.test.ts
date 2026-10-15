import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANALYTICS_ADDRESS,
  readAnalyticsAddress,
  resolvePeriod,
  writeAnalyticsAddress,
} from '../address';

const read = (query: string) => readAnalyticsAddress(new URLSearchParams(query));
const ANNA = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

describe('readAnalyticsAddress', () => {
  it('opens on the last 30 days, compared, names in full, the first table', () => {
    expect(read('')).toEqual(DEFAULT_ANALYTICS_ADDRESS);
    expect(DEFAULT_ANALYTICS_ADDRESS).toMatchObject({
      preset: '30d',
      custom: null,
      compare: true,
      names: 'full',
      includeTest: false,
      table: 'cleaningsByProperty',
    });
  });

  it('reads a quick period, or two days of its own', () => {
    expect(read('p=lastMonth').preset).toBe('lastMonth');
    expect(read('from=2026-09-01&to=2026-09-15')).toMatchObject({
      preset: null,
      custom: { from: '2026-09-01', to: '2026-09-15' },
    });
  });

  it('falls back to the default period on days that make no period', () => {
    expect(read('from=2026-09-15&to=2026-09-01')).toMatchObject({ preset: '30d', custom: null });
    expect(read('from=2026-09-15')).toMatchObject({ preset: '30d', custom: null });
    expect(read('p=forever').preset).toBe('30d');
  });

  it('reads the switches and the table', () => {
    expect(read('cmp=0&names=initials&test=1&tab=problemsByTechnician')).toMatchObject({
      compare: false,
      names: 'initials',
      includeTest: true,
      table: 'problemsByTechnician',
    });
    expect(read('tab=nonsense').table).toBe('cleaningsByProperty');
  });

  it('reads the filters, keeping only the values that make sense', () => {
    expect(
      read(`prop=12,x,7&ppl=${ANNA},bad&st=done,flying&pst=open&urg=high,low`).filters,
    ).toEqual({
      propertyIds: [12, 7],
      personIds: [ANNA],
      taskStatuses: ['done'],
      problemStatuses: ['open'],
      priorities: ['high', 'low'],
      hideArchived: false,
    });
  });

  it('shows the archived listings unless the address hides them', () => {
    expect(read('').filters.hideArchived).toBe(false);
    expect(read('arch=1').filters.hideArchived).toBe(true);
    expect(read('arch=yes').filters.hideArchived).toBe(false);
  });
});

describe('writeAnalyticsAddress', () => {
  it('writes nothing for the defaults', () => {
    expect(writeAnalyticsAddress(DEFAULT_ANALYTICS_ADDRESS)).toBe('');
  });

  it('writes only what differs, and reads back the same', () => {
    const address = {
      ...DEFAULT_ANALYTICS_ADDRESS,
      preset: null,
      custom: { from: '2026-09-01', to: '2026-09-15' },
      compare: false,
      names: 'initials' as const,
      table: 'checkoutsByProperty' as const,
      filters: {
        ...DEFAULT_ANALYTICS_ADDRESS.filters,
        propertyIds: [12],
        priorities: ['high' as const],
        hideArchived: true,
      },
    };
    const query = writeAnalyticsAddress(address);
    expect(query).toBe(
      'from=2026-09-01&to=2026-09-15&cmp=0&names=initials&tab=checkoutsByProperty&prop=12&urg=high&arch=1',
    );
    expect(read(query)).toEqual(address);
  });
});

describe('resolvePeriod', () => {
  it('turns a quick period into days from today, and keeps days of its own', () => {
    expect(resolvePeriod({ ...DEFAULT_ANALYTICS_ADDRESS, preset: '7d' }, '2026-10-15')).toEqual({
      from: '2026-10-09',
      to: '2026-10-15',
    });
    expect(
      resolvePeriod(
        { ...DEFAULT_ANALYTICS_ADDRESS, preset: null, custom: { from: '2026-01-01', to: '2026-01-31' } },
        '2026-10-15',
      ),
    ).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });
});
