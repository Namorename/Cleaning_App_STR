import { describe, expect, it } from 'vitest';

import {
  changeOf,
  formatChange,
  formatNumber,
  formatPercent,
  initials,
  NO_VALUE,
  personLabel,
} from '../format';

/** Intl puts narrow and plain no-break spaces in numbers; the tests read them as spaces. */
const plain = (text: string) => text.replace(/[  ]/g, ' ');

describe('formatNumber and formatPercent', () => {
  it('writes numbers the way the chosen language does', () => {
    expect(formatNumber(1234.5, 'en', 1)).toBe('1,234.5');
    expect(plain(formatNumber(1234.5, 'ru', 1))).toBe('1 234,5');
    expect(plain(formatNumber(1234.5, 'cs', 1))).toBe('1 234,5');
    expect(formatNumber(75, 'en')).toBe('75');
  });

  it('writes a share as a percentage', () => {
    expect(formatPercent(0.2, 'en')).toBe('20%');
    expect(formatPercent(0.155, 'en')).toBe('15.5%');
    expect(plain(formatPercent(0.2, 'cs'))).toBe('20 %');
  });

  it('shows a dash for a figure there was nothing to count for', () => {
    expect(formatNumber(null, 'en')).toBe(NO_VALUE);
    expect(formatPercent(null, 'en')).toBe(NO_VALUE);
  });
});

describe('changeOf', () => {
  it('measures a count against the previous period, relatively', () => {
    expect(changeOf(12, 10)).toEqual({ kind: 'relative', value: 0.2, direction: 'up', tone: 'good' });
    expect(changeOf(8, 10)).toEqual({ kind: 'relative', value: -0.2, direction: 'down', tone: 'bad' });
    expect(changeOf(10, 10)).toEqual({ kind: 'relative', value: 0, direction: 'flat', tone: 'neutral' });
  });

  it('says a rise is bad where less is better, and nothing where neither is', () => {
    expect(changeOf(3, 2, 'relative', 'down')?.tone).toBe('bad');
    expect(changeOf(1, 2, 'relative', 'down')?.tone).toBe('good');
    expect(changeOf(3, 2, 'relative', 'none')?.tone).toBe('neutral');
  });

  it('moves a share in percentage points', () => {
    expect(changeOf(0.25, 0.2, 'points')).toEqual({
      kind: 'points',
      value: 5,
      direction: 'up',
      tone: 'good',
    });
  });

  it('has no change without a base to compare with', () => {
    expect(changeOf(5, 0)).toBeNull();
    expect(changeOf(null, 3)).toBeNull();
    expect(changeOf(3, null)).toBeNull();
  });
});

describe('formatChange', () => {
  it('signs the change', () => {
    expect(formatChange({ kind: 'relative', value: 0.2, direction: 'up', tone: 'good' }, 'en')).toBe(
      '+20%',
    );
    expect(
      formatChange({ kind: 'relative', value: -0.125, direction: 'down', tone: 'bad' }, 'en'),
    ).toBe('-13%');
    expect(formatChange({ kind: 'points', value: 5, direction: 'up', tone: 'good' }, 'en')).toBe(
      '+5',
    );
    expect(formatChange({ kind: 'relative', value: 0, direction: 'flat', tone: 'neutral' }, 'en')).toBe(
      '0%',
    );
  });
});

describe('initials and personLabel', () => {
  it('shortens a name to its initials', () => {
    expect(initials('Anna Novak')).toBe('A. N.');
    expect(initials('anna')).toBe('A.');
    expect(initials('  Jan   van  Dijk ')).toBe('J. V. D.');
    expect(initials('Ольга Петрова')).toBe('О. П.');
    expect(initials(null)).toBe('');
  });

  it('shows a name in full or as initials, as the page is set', () => {
    expect(personLabel('Anna Novak', 'full')).toBe('Anna Novak');
    expect(personLabel('Anna Novak', 'initials')).toBe('A. N.');
    expect(personLabel(null, 'full')).toBe(NO_VALUE);
  });
});
