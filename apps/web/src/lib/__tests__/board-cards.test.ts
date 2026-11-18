import {
  boardSummary,
  CARD_COLORS,
  CARD_COLOR_NAMES,
  dueState,
  EMPTY_CARD_FILTERS,
  hasCardFilters,
  isBoardColumn,
  isCardColor,
  isEveryStepDone,
  matchesCardFilters,
  orderCards,
  splitLinks,
  stepCount,
  TONE_COLORS,
  type BoardCardFacts,
} from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

/**
 * The rules of a manager board card both apps read (packages/shared/src/boards):
 * the due date's state, the progress, the links in the words, the search,
 * the filters, the order and the summary — and the palette.
 */

const TODAY = '2026-11-18';

function card(overrides: Partial<BoardCardFacts> = {}): BoardCardFacts {
  return {
    title: 'Card',
    description: '',
    color: null,
    due_on: null,
    column_key: 'open',
    created_at: '2026-11-01T10:00:00Z',
    steps: [],
    ...overrides,
  };
}

describe('the due date', () => {
  test.each([
    [null, 'open', 'none'],
    ['2026-11-17', 'open', 'overdue'],
    ['2026-11-18', 'in_progress', 'today'],
    ['2026-11-19', 'assigned', 'week'],
    ['2026-11-24', 'open', 'week'],
    ['2026-11-25', 'open', 'later'],
    ['2026-11-01', 'resolved', 'later'],
    ['2026-11-18', 'resolved', 'later'],
  ] as const)('%s in %s is %s', (dueOn, column, state) => {
    expect(dueState(dueOn, TODAY, column)).toBe(state);
  });

  test('the week crosses a month and a year', () => {
    expect(dueState('2027-01-02', '2026-12-30', 'open')).toBe('week');
    expect(dueState('2027-01-06', '2026-12-30', 'open')).toBe('later');
  });
});

describe('steps', () => {
  test('counts the ticked ones', () => {
    expect(stepCount([{ done_at: 'x' }, { done_at: null }, { done_at: 'y' }])).toEqual({
      done: 2,
      total: 3,
    });
  });

  test('every step done needs at least one step', () => {
    expect(isEveryStepDone([])).toBe(false);
    expect(isEveryStepDone([{ done_at: 'x' }, { done_at: null }])).toBe(false);
    expect(isEveryStepDone([{ done_at: 'x' }, { done_at: 'y' }])).toBe(true);
  });
});

describe('links in the words', () => {
  test('finds http and https links and keeps the rest as typed', () => {
    expect(splitLinks('Plan: https://example.com/a?b=1 and http://x.cz.')).toEqual([
      { kind: 'text', text: 'Plan: ' },
      { kind: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'http://x.cz', href: 'http://x.cz' },
      { kind: 'text', text: '.' },
    ]);
  });

  test('a closing bracket or a full stop after a link is the sentence', () => {
    expect(splitLinks('(see https://a.com/x).')).toEqual([
      { kind: 'text', text: '(see ' },
      { kind: 'link', text: 'https://a.com/x', href: 'https://a.com/x' },
      { kind: 'text', text: ').' },
    ]);
  });

  test('no other scheme is a link, and words without links are one part', () => {
    expect(splitLinks('javascript:alert(1) ftp://x mailto:a@b')).toEqual([
      { kind: 'text', text: 'javascript:alert(1) ftp://x mailto:a@b' },
    ]);
    expect(splitLinks('')).toEqual([]);
  });

  test("a bracket the link opened is the link's; one it did not open is the sentence's", () => {
    expect(splitLinks('https://en.wikipedia.org/wiki/Foo_(bar).')).toEqual([
      {
        kind: 'link',
        text: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        href: 'https://en.wikipedia.org/wiki/Foo_(bar)',
      },
      { kind: 'text', text: '.' },
    ]);
  });

  test('a long run of punctuation after a link is read in linear time', () => {
    const started = Date.now();
    const parts = splitLinks(`https://a.cz/${'.'.repeat(20000)}`);
    expect(Date.now() - started).toBeLessThan(500);
    expect(parts[0]).toEqual({ kind: 'link', text: 'https://a.cz/', href: 'https://a.cz/' });
  });

  test('a bare scheme is not a link', () => {
    expect(splitLinks('https:// nothing')).toEqual([{ kind: 'text', text: 'https:// nothing' }]);
  });
});

describe('the search and the filters', () => {
  const blue = card({ title: 'Ремонт ванной', color: 'blue', due_on: '2026-11-10' });
  const plain = card({ title: 'Звонок', description: 'Šárka, Vinohradská', due_on: TODAY });
  const steps = card({
    title: 'Закупка',
    color: 'teal',
    steps: [
      { done_at: 'x', body: 'Плитка' },
      { done_at: null, body: 'Краска' },
    ],
  });
  const done = card({ title: 'Готово', due_on: '2026-11-01', column_key: 'resolved' });
  const all = [blue, plain, steps, done];
  const pick = (filters: Partial<typeof EMPTY_CARD_FILTERS>) =>
    all
      .filter((one) => matchesCardFilters(one, { ...EMPTY_CARD_FILTERS, ...filters }, TODAY))
      .map((one) => one.title);

  test('nothing set lets every card through', () => {
    expect(pick({})).toEqual(['Ремонт ванной', 'Звонок', 'Закупка', 'Готово']);
    expect(hasCardFilters(EMPTY_CARD_FILTERS)).toBe(false);
  });

  test('the search reads the title, the description and the steps, any order, no diacritics', () => {
    expect(pick({ query: 'vinohradska sarka' })).toEqual(['Звонок']);
    expect(pick({ query: 'краска' })).toEqual(['Закупка']);
    expect(pick({ query: 'ремонт' })).toEqual(['Ремонт ванной']);
  });

  test('by colour, «none» being a card without one', () => {
    expect(pick({ colors: ['blue'] })).toEqual(['Ремонт ванной']);
    expect(pick({ colors: ['none'] })).toEqual(['Звонок', 'Готово']);
    expect(pick({ colors: ['blue', 'teal'] })).toEqual(['Ремонт ванной', 'Закупка']);
  });

  test('by due date: a done card is never overdue', () => {
    expect(pick({ due: 'overdue' })).toEqual(['Ремонт ванной']);
    expect(pick({ due: 'today' })).toEqual(['Звонок']);
    expect(pick({ due: 'week' })).toEqual(['Звонок']);
    expect(pick({ due: 'none' })).toEqual(['Закупка']);
  });

  test('only cards with a step still to tick', () => {
    expect(pick({ openSteps: true })).toEqual(['Закупка']);
    expect(hasCardFilters({ ...EMPTY_CARD_FILTERS, openSteps: true })).toBe(true);
  });
});

describe('the order of a column', () => {
  const a = card({ title: 'a', due_on: '2026-11-20', created_at: '2026-11-01T00:00:00Z' });
  const b = card({ title: 'b', due_on: null, created_at: '2026-11-05T00:00:00Z' });
  const c = card({ title: 'c', due_on: '2026-11-19', created_at: '2026-11-02T00:00:00Z' });
  const d = card({ title: 'd', due_on: null, created_at: '2026-11-03T00:00:00Z' });

  test('by due date: the nearest first, none last, then the newest', () => {
    expect(orderCards([a, b, c, d], 'due').map((one) => one.title)).toEqual(['c', 'a', 'b', 'd']);
  });

  test('the newest first', () => {
    expect(orderCards([a, b, c, d], 'newest').map((one) => one.title)).toEqual([
      'b',
      'd',
      'c',
      'a',
    ]);
  });

  test('leaves the list it was given as it was', () => {
    const list = [a, b];
    orderCards(list, 'due');
    expect(list).toEqual([a, b]);
  });
});

test('the summary counts open cards, the overdue and those due today', () => {
  expect(
    boardSummary(
      [
        card({ due_on: '2026-11-17' }),
        card({ due_on: TODAY }),
        card({ due_on: TODAY, column_key: 'in_progress' }),
        card({ due_on: '2026-11-01', column_key: 'resolved' }),
        card(),
      ],
      TODAY,
    ),
  ).toEqual({ overdue: 1, today: 2, open: 4 });
});

describe('the palette', () => {
  test("eight colours, the server's eight, in both themes", () => {
    expect(CARD_COLOR_NAMES).toEqual([
      'blue',
      'sky',
      'teal',
      'green',
      'olive',
      'violet',
      'orchid',
      'slate',
    ]);
    for (const theme of ['light', 'dark'] as const) {
      expect(Object.keys(CARD_COLORS[theme]).sort()).toEqual([...CARD_COLOR_NAMES].sort());
    }
    expect(isCardColor('blue')).toBe(true);
    expect(isCardColor('red')).toBe(false);
    expect(isCardColor(null)).toBe(false);
    expect(isBoardColumn('resolved')).toBe(true);
    expect(isBoardColumn('cancelled')).toBe(false);
  });

  test('no card colour is a colour of urgency', () => {
    const urgent = new Set(
      (['overdue', 'urgent', 'critical', 'today', 'inProgress'] as const).flatMap((tone) =>
        (['light', 'dark'] as const).flatMap((theme) => [
          TONE_COLORS[theme][tone].mark.toLowerCase(),
          TONE_COLORS[theme][tone].border.toLowerCase(),
        ]),
      ),
    );
    for (const theme of ['light', 'dark'] as const) {
      for (const color of CARD_COLOR_NAMES) {
        expect(urgent.has(CARD_COLORS[theme][color].stripe.toLowerCase())).toBe(false);
      }
    }
  });

  test('every stripe holds 3:1 on the surface, and the body text 4.5:1 on its fill', () => {
    const surface = { light: '#fffcfb', dark: '#2a1f1b' };
    const text = { light: '#1e1816', dark: '#f6f1f0' };
    for (const theme of ['light', 'dark'] as const) {
      for (const color of CARD_COLOR_NAMES) {
        const { stripe, tint } = CARD_COLORS[theme][color];
        expect(contrast(stripe, surface[theme])).toBeGreaterThanOrEqual(3);
        expect(contrast(text[theme], tint)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(left: string, right: string): number {
  const [light, dark] = [luminance(left), luminance(right)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
