import { describe, expect, test } from 'vitest';

import {
  DEFAULT_APARTMENTS_ADDRESS,
  readApartmentsAddress,
  writeApartmentsAddress,
} from '../address';

const read = (query: string) => readApartmentsAddress(new URLSearchParams(query));

describe('the address of «Объекты»', () => {
  test('a bare address is the working listings, nothing searched, nothing open', () => {
    expect(read('')).toEqual({ status: 'active', query: '', listing: null, card: 'info' });
    expect(DEFAULT_APARTMENTS_ADDRESS).toEqual(read(''));
  });

  test('reads the status tab, the search, the open listing and its tab', () => {
    expect(read('status=archived&q=royal+cerna&listing=201&card=bookings')).toEqual({
      status: 'archived',
      query: 'royal cerna',
      listing: 201,
      card: 'bookings',
    });
  });

  // A hand-edited or old link opens the registry rather than breaking it.
  test('drops what it does not recognise, value by value', () => {
    expect(read('status=deleted&listing=abc&card=photos')).toEqual(DEFAULT_APARTMENTS_ADDRESS);
    expect(read('listing=-4').listing).toBeNull();
    expect(read('listing=1.5').listing).toBeNull();
  });

  test('writes only what differs from the defaults, in one order', () => {
    expect(writeApartmentsAddress(DEFAULT_APARTMENTS_ADDRESS)).toBe('');
    expect(
      writeApartmentsAddress({
        status: 'maintenance',
        query: 'vinohrady 12',
        listing: 101,
        card: 'checklist',
      }),
    ).toBe('status=maintenance&q=vinohrady+12&listing=101&card=checklist');
    expect(writeApartmentsAddress({ ...DEFAULT_APARTMENTS_ADDRESS, query: '  ' })).toBe('');
  });

  test('what it writes it reads back the same', () => {
    const address = {
      status: 'active' as const,
      query: 'Anděl & co',
      listing: 102,
      card: 'maintenance' as const,
    };

    expect(read(writeApartmentsAddress(address))).toEqual(address);
  });
});
