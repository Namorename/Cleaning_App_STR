import { describe, expect, test } from 'vitest';

import { DEFAULT_SUPPLIES_ADDRESS, readSuppliesAddress, writeSuppliesAddress } from '../address';

const read = (query: string) => readSuppliesAddress(new URLSearchParams(query));

const REQUEST = '55555555-5555-4555-8555-555555555555';

describe('the address of «Заявки»', () => {
  test('a bare address is the new requests, nothing searched, no dates, nothing open', () => {
    expect(read('')).toEqual({
      tab: 'new',
      query: '',
      dates: { from: '', to: '' },
      request: null,
    });
    expect(DEFAULT_SUPPLIES_ADDRESS).toEqual(read(''));
  });

  test('reads the tab, the search, the dates and the open request', () => {
    expect(read(`tab=all&q=karlin&from=2026-09-01&to=2026-09-30&request=${REQUEST}`)).toEqual({
      tab: 'all',
      query: 'karlin',
      dates: { from: '2026-09-01', to: '2026-09-30' },
      request: REQUEST,
    });
  });

  test('an id written in capitals is the same request', () => {
    expect(read(`request=${REQUEST.toUpperCase()}`).request).toBe(REQUEST);
  });

  // A hand-edited or old link opens the list rather than breaking it.
  test('drops what it does not recognise, value by value', () => {
    expect(read('tab=rejected&from=yesterday&to=2026-13-40&request=42')).toEqual(
      DEFAULT_SUPPLIES_ADDRESS,
    );
    expect(read('request=55555555-5555').request).toBeNull();
    expect(read(`tab=fulfilled&request=${REQUEST}x`)).toEqual({
      ...DEFAULT_SUPPLIES_ADDRESS,
      tab: 'fulfilled',
    });
  });

  test('writes only what differs from the defaults, in one order', () => {
    expect(writeSuppliesAddress(DEFAULT_SUPPLIES_ADDRESS)).toBe('');
    expect(
      writeSuppliesAddress({
        tab: 'inProgress',
        query: 'мешки 60',
        dates: { from: '2026-09-01', to: '' },
        request: REQUEST,
      }),
    ).toBe(`tab=inProgress&q=%D0%BC%D0%B5%D1%88%D0%BA%D0%B8+60&from=2026-09-01&request=${REQUEST}`);
    expect(writeSuppliesAddress({ ...DEFAULT_SUPPLIES_ADDRESS, query: '  ' })).toBe('');
  });

  test('what it writes it reads back the same', () => {
    const address = {
      tab: 'fulfilled' as const,
      query: 'Karlín & co',
      dates: { from: '', to: '2026-09-09' },
      request: REQUEST,
    };

    expect(read(writeSuppliesAddress(address))).toEqual(address);
  });
});
