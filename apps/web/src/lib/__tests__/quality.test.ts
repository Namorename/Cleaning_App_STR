import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_QUALITY_WINDOW,
  QUALITY_THEME_CODES,
  QUALITY_THEMES,
  QUALITY_WINDOWS,
  isQualityTheme,
  isQualityWindow,
  ratePer100,
  showsRate,
  stateRank,
  themeStateOf,
  trendOf,
  trustOf,
  type ThemeStateInput,
  type TrendInput,
} from '@str-ops/shared';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../../..');
const MIGRATION = 'supabase/migrations/20261106120000_property_quality.sql';
const DENO_THEMES = 'supabase/functions/_shared/signals/themes.ts';

const trend = (over: Partial<TrendInput>): ReturnType<typeof trendOf> =>
  trendOf({
    scope: 'place',
    seasonal: false,
    current: 0,
    previous: 0,
    stays: 100,
    staysPrevious: 100,
    ...over,
  });

const state = (over: Partial<ThemeStateInput>): ReturnType<typeof themeStateOf> =>
  themeStateOf({
    recent: 0,
    older: 0,
    lastOn: null,
    closedOn: null,
    openWork: 0,
    work180: 0,
    workFrom: '2026-10-19',
    ...over,
  });

describe('the list of themes', () => {
  it('has the 35 themes of the migration, in its order', () => {
    const sql = readFileSync(resolve(ROOT, MIGRATION), 'utf8');
    const block = sql.slice(sql.indexOf('insert into public.issue_themes'), sql.indexOf('-- The dictionary'));
    const inSql = [...block.matchAll(/\('([a-z_]+)',\s+'([a-z]+)',\s+\d+, (?:true|false)\)/g)];

    expect(QUALITY_THEME_CODES).toHaveLength(35);
    expect(inSql.map((row) => row[1])).toEqual(QUALITY_THEME_CODES);
    expect(inSql.map((row) => row[2])).toEqual(QUALITY_THEME_CODES.map((code) => QUALITY_THEMES[code]));
  });

  it('is the list the Deno functions read', () => {
    const copy = readFileSync(resolve(ROOT, DENO_THEMES), 'utf8');
    const inCopy = [...copy.slice(copy.indexOf('ISSUE_THEMES')).matchAll(/^\s+"([a-z_]+)",$/gm)];

    expect(inCopy.map((row) => row[1])).toEqual(QUALITY_THEME_CODES);
  });

  it('knows a theme from anything else', () => {
    expect(isQualityTheme('wifi')).toBe(true);
    expect(isQualityTheme('toString')).toBe(false);
    expect(isQualityTheme(null)).toBe(false);
  });
});

describe('the windows', () => {
  it('are the five of the decision, twelve months by default', () => {
    expect(QUALITY_WINDOWS).toEqual(['14d', '1m', '3m', '6m', '12m']);
    expect(DEFAULT_QUALITY_WINDOW).toBe('12m');
    expect(isQualityWindow('12m')).toBe(true);
    expect(isQualityWindow('30d')).toBe(false);
  });
});

describe('trendOf', () => {
  it('says nothing about a seasonal theme at a place', () => {
    expect(trend({ seasonal: true, current: 30, previous: 2 })).toBe('seasonal');
  });

  it('shows a seasonal theme for a group and the portfolio', () => {
    expect(trend({ scope: 'group', seasonal: true, current: 30, previous: 2 })).toBe('rising');
    expect(trend({ scope: 'portfolio', seasonal: true, current: 2, previous: 30 })).toBe('falling');
  });

  it('wants 40 stays in both windows at a place', () => {
    expect(trend({ stays: 39, current: 20, previous: 1 })).toBe('too_little');
    expect(trend({ staysPrevious: 39, current: 20, previous: 1 })).toBe('too_little');
    expect(trend({ stays: 40, staysPrevious: 40, current: 20, previous: 1 })).toBe('rising');
  });

  it('does not want them from a group or the portfolio', () => {
    expect(trend({ scope: 'group', stays: 10, staysPrevious: 10, current: 20, previous: 1 })).toBe('rising');
    expect(trend({ scope: 'portfolio', stays: 10, staysPrevious: 10, current: 1, previous: 20 })).toBe('falling');
  });

  it('has nothing to compare with when the window before has no stays', () => {
    expect(trend({ scope: 'portfolio', staysPrevious: 0, current: 20 })).toBe('no_base');
    expect(trend({ scope: 'group', stays: 0, previous: 20 })).toBe('no_base');
  });

  it('holds small numbers for chance', () => {
    expect(trend({ current: 3, previous: 1 })).toBe('steady');
    expect(trend({ current: 4, previous: 0 })).toBe('steady');
  });

  it('wants the larger number to reach five', () => {
    expect(trend({ current: 4.9, previous: 0 })).toBe('steady');
    expect(trend({ current: 5, previous: 0 })).toBe('rising');
  });

  it('counts episodes against stays, not bare', () => {
    // Twice the stays and twice the episodes is the same rate.
    expect(trend({ current: 20, previous: 10, stays: 200, staysPrevious: 100 })).toBe('steady');
    expect(trend({ current: 20, previous: 10, stays: 100, staysPrevious: 100 })).toBe('rising');
  });

  it('is steady when nothing was said at all', () => {
    expect(trend({})).toBe('steady');
  });
});

describe('showsRate', () => {
  it('keeps a place to a count below 20 stays', () => {
    expect(showsRate('place', '12m', 19)).toBe(false);
    expect(showsRate('place', '12m', 20)).toBe(true);
  });

  it('keeps a place to a count in the short windows', () => {
    expect(showsRate('place', '14d', 100)).toBe(false);
    expect(showsRate('place', '1m', 100)).toBe(false);
    expect(showsRate('place', '3m', 100)).toBe(true);
  });

  it('lets a group show a rate from a month', () => {
    expect(showsRate('group', '14d', 100)).toBe(false);
    expect(showsRate('group', '1m', 100)).toBe(true);
  });

  it('lets the portfolio show a rate in every window', () => {
    expect(showsRate('portfolio', '14d', 100)).toBe(true);
    expect(showsRate('portfolio', '14d', 19)).toBe(false);
  });
});

describe('ratePer100', () => {
  it('is episodes on 100 stays', () => {
    expect(ratePer100(3, 76)).toBe(3.9);
  });

  it('is nothing without stays', () => {
    expect(ratePer100(3, 0)).toBeNull();
  });
});

describe('themeStateOf', () => {
  it('puts live work first', () => {
    expect(state({ openWork: 1, recent: 5, closedOn: '2026-11-01', lastOn: '2026-11-02' })).toBe('in_work');
  });

  it('sees a fix that came after the last episode', () => {
    expect(state({ closedOn: '2026-11-02', lastOn: '2026-11-01' })).toBe('fixed');
    expect(state({ closedOn: '2026-11-01', lastOn: '2026-11-01' })).toBe('fixed');
  });

  it('sees an episode that came after the fix', () => {
    expect(state({ closedOn: '2026-11-01', lastOn: '2026-11-02' })).toBe('returned');
  });

  it('calls two recent episodes with nothing before them new', () => {
    expect(state({ recent: 2, lastOn: '2026-11-01' })).toBe('new');
  });

  it('does not call one episode new', () => {
    expect(state({ recent: 1, lastOn: '2026-11-01' })).toBe('single');
  });

  it('does not call a theme new when it was said before', () => {
    expect(state({ recent: 2, older: 1, lastOn: '2026-11-01' })).toBe('single');
  });

  it('does not take an old episode for an unanswered one', () => {
    expect(state({ older: 3, lastOn: '2026-08-01' })).toBe('no_repair_data');
  });

  it('has no record of repairs when the company has none', () => {
    expect(state({ older: 3, lastOn: '2026-08-01', workFrom: null })).toBe('no_repair_data');
  });

  it('leaves the rest quiet', () => {
    expect(state({ older: 1, lastOn: '2026-10-25', work180: 1 })).toBe('quiet');
  });

  it('ranks what nobody answered first', () => {
    expect(stateRank('returned')).toBeLessThan(stateRank('in_work'));
    expect(stateRank('new')).toBeLessThan(stateRank('fixed'));
    expect(stateRank('fixed')).toBeLessThan(stateRank('quiet'));
  });
});

describe('trustOf', () => {
  it('reads stays and rated reviews', () => {
    expect(trustOf(40, 20)).toBe('high');
    expect(trustOf(40, 19)).toBe('medium');
    expect(trustOf(20, 0)).toBe('medium');
    expect(trustOf(19, 100)).toBe('low');
  });
});
