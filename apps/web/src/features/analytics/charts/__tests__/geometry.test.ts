import { describe, expect, it } from 'vitest';

import { niceMax, share, ticks } from '../geometry';

describe('niceMax', () => {
  it('rounds an axis up to 1, 2, 2.5, 5 or 10 times a power of ten', () => {
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(21)).toBe(25);
    expect(niceMax(40)).toBe(50);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(101)).toBe(200);
  });

  it('keeps an empty chart drawable', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
  });
});

describe('ticks', () => {
  it('divides the axis in whole steps', () => {
    expect(ticks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(ticks(100)).toEqual([0, 25, 50, 75, 100]);
  });

  it('falls back to the ends when the steps would not be whole', () => {
    expect(ticks(1)).toEqual([0, 1]);
    expect(ticks(2.5)).toEqual([0, 2.5]);
  });
});

describe('share', () => {
  it('is a bar length between nothing and the whole axis', () => {
    expect(share(5, 20)).toBe(0.25);
    expect(share(30, 20)).toBe(1);
    expect(share(-1, 20)).toBe(0);
    expect(share(5, 0)).toBe(0);
  });
});
