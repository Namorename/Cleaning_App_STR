import { describe, expect, test } from 'vitest';

import {
  DEFAULT_QUALITY_ADDRESS,
  qualityAreasHref,
  qualityHref,
  qualityPlaceHref,
  readQualityAddress,
  readQualityWindow,
  writeQualityAddress,
  writeQualityWindow,
} from '../address';

describe('the address of the overview', () => {
  test('is empty for the screen’s defaults', () => {
    expect(writeQualityAddress(DEFAULT_QUALITY_ADDRESS)).toBe('');
    expect(readQualityAddress(new URLSearchParams(''))).toEqual(DEFAULT_QUALITY_ADDRESS);
  });

  test('comes back as it was written', () => {
    const address = { window: '3m', city: 'České Budějovice', onlyNew: true } as const;

    const search = writeQualityAddress(address);

    expect(readQualityAddress(new URLSearchParams(search))).toEqual(address);
  });

  test('a window that makes no sense gives way to twelve months, the rest stays', () => {
    expect(readQualityAddress(new URLSearchParams('w=99y&city=Brno'))).toEqual({
      window: '12m',
      city: 'Brno',
      onlyNew: false,
    });
  });
});

describe('the address of a card', () => {
  test('keeps its window only', () => {
    expect(writeQualityWindow('6m')).toBe('w=6m');
    expect(writeQualityWindow('12m')).toBe('');
    expect(readQualityWindow(new URLSearchParams('w=14d'))).toBe('14d');
  });

  test('the links carry the window both ways', () => {
    expect(qualityPlaceHref(7, '3m')).toBe('/quality/7?w=3m');
    expect(qualityPlaceHref(7, '12m')).toBe('/quality/7');
    expect(qualityHref('3m')).toBe('/quality?w=3m');
    expect(qualityHref('12m')).toBe('/quality');
    expect(qualityAreasHref('3m')).toBe('/quality/areas?w=3m');
    expect(qualityAreasHref('12m')).toBe('/quality/areas');
  });
});
