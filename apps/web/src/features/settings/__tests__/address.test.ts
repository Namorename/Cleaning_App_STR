import { describe, expect, test } from 'vitest';

import {
  DEFAULT_SETTINGS_ADDRESS,
  readSettingsAddress,
  SETTINGS_SECTIONS,
  writeSettingsAddress,
} from '../address';

const read = (query: string) => readSettingsAddress(new URLSearchParams(query));

describe('the address of «Настройки»', () => {
  test('a bare address is the account, the first section of the submenu', () => {
    expect(read('')).toEqual({ section: 'account' });
    expect(DEFAULT_SETTINGS_ADDRESS).toEqual(read(''));
    expect(SETTINGS_SECTIONS[0]).toBe('account');
  });

  test('reads every section the submenu lists', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(read(`section=${section}`)).toEqual({ section });
    }
  });

  // A hand-edited or old link opens the page rather than breaking it.
  test('a section it does not know is the account', () => {
    expect(read('section=billing')).toEqual(DEFAULT_SETTINGS_ADDRESS);
    expect(read('section=')).toEqual(DEFAULT_SETTINGS_ADDRESS);
    expect(read('section=PROCESS')).toEqual(DEFAULT_SETTINGS_ADDRESS);
  });

  test('writes only what differs from the bare page', () => {
    expect(writeSettingsAddress({ section: 'account' })).toBe('');
    expect(writeSettingsAddress({ section: 'process' })).toBe('section=process');
  });

  test('what it writes, it reads back', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(read(writeSettingsAddress({ section }))).toEqual({ section });
    }
  });
});
