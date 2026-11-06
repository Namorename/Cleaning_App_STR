import { QUALITY_WINDOWS, type QualityWindow } from '@str-ops/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';

import { overviewSchema, type QualityOverview } from '../schema';
import {
  byCity,
  FOURTEEN_DAYS,
  NOT_READ,
  META,
  overviewOfRows,
  placeOf,
  READ_HISTORY,
  SIX_MONTHS,
  themeOf,
} from './fixtures';

const state: {
  read: { data?: QualityOverview; isError: boolean; error: unknown };
  windows: QualityWindow[];
} = { read: { isError: false, error: null }, windows: [] };

vi.mock('../use-quality', () => ({
  useQualityOverview: (window: QualityWindow) => {
    state.windows.push(window);
    return state.read;
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { QualityView } from '../quality-view';

function answering(data: QualityOverview): void {
  state.read = { data, isError: false, error: null };
}

const FIVE_FLATS = [1, 2, 3, 4, 5].map((id) => placeOf({ id, name: `Flat ${id}` }));

beforeAll(() => {
  // jsdom has no PointerEvent; Base UI's switch builds one on a press (as in ui/primitives.test).
  if (typeof window.PointerEvent !== 'function') {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: class PointerEvent extends MouseEvent {},
    });
  }
});

beforeEach(() => {
  window.history.replaceState(null, '', '/quality');
  state.windows = [];
  answering(overviewOfRows([placeOf()], []));
});

describe('QualityView: the portfolio', () => {
  test('opens on twelve months, the window pressed among the five', () => {
    render(<QualityView />);

    const pills = within(screen.getByRole('group', { name: 'Период' })).getAllByRole('button');
    expect(pills).toHaveLength(QUALITY_WINDOWS.length);
    expect(screen.getByRole('button', { name: '12 месяцев' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(state.windows.at(-1)).toBe('12m');
  });

  test('a window is kept in the address and asked of the server', () => {
    render(<QualityView />);

    fireEvent.click(screen.getByRole('button', { name: '3 месяца' }));

    expect(window.location.search).toBe('?w=3m');
    expect(state.windows.at(-1)).toBe('3m');
    expect(screen.getByRole('button', { name: '3 месяца' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('says what a theme is by layer, with the numbers of its rate, and no sum', () => {
    answering(
      overviewOfRows(
        [placeOf({ stays: 76 })],
        [themeOf({ reviews: 3, found: 2, reported: 1, recent: 1 })],
      ),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('3 жалобы · 2 находки · 1 заведено')).toBeInTheDocument();
    expect(within(block).getByText('4 на 100 заездов (3 из 76)')).toBeInTheDocument();
    expect(within(block).queryByText(/\b6\b/)).not.toBeInTheDocument();
  });

  test('fills the tiles from the whole portfolio', () => {
    answering(
      overviewOfRows(
        [placeOf({ id: 1, stays: 70 }), placeOf({ id: 2, stays: 6, rating_n: 10, rating_avg: 8 })],
        [themeOf({ reviews: 2, recent: 2 })],
      ),
    );
    render(<QualityView />);

    const tiles = screen.getByRole('region', { name: 'Портфель за период' });
    const tile = (label: string) => within(tiles).getByText(label).parentElement as HTMLElement;
    expect(within(tile('Заезды')).getByText('76')).toBeInTheDocument();
    expect(within(tile('Отзывы с оценкой')).getByText('40')).toBeInTheDocument();
    expect(within(tile('Отзывы с оценкой')).getByText('средняя 8,6')).toBeInTheDocument();
    expect(within(tile('Новые темы')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Вернувшиеся темы')).getByText('0')).toBeInTheDocument();
  });

  test('names no growth in percent, and offers nothing to press but the filters', () => {
    answering(
      overviewOfRows(
        [placeOf()],
        [themeOf({ reviews: 20, reviews_prev: 5, recent: 2 })],
        SIX_MONTHS,
      ),
    );
    render(<QualityView />);

    expect(document.body.textContent).not.toMatch(/%/);
    expect(screen.getAllByRole('button')).toHaveLength(QUALITY_WINDOWS.length);
  });

  test('a theme this build does not know leaves the screen standing, without it', () => {
    const data = overviewOfRows([placeOf()], [themeOf({ reviews: 2 })]);
    answering(
      overviewSchema.parse({
        ...data,
        themes: [...data.themes, { ...themeOf({ reviews: 9 }), theme: 'teleport' }],
      }),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('Wi-Fi')).toBeInTheDocument();
    expect(within(block).getByText('2 жалобы')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('teleport');
  });

  test('a seasonal theme beside a trend that does compare says the season may be it', () => {
    answering(
      overviewOfRows(
        [placeOf()],
        [themeOf({ theme: 'heating', seasonal: true, reviews: 20, reviews_prev: 5 })],
        SIX_MONTHS,
      ),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('Растёт')).toBeInTheDocument();
    expect(
      within(block).getByText('сезонная тема: перемена может быть от сезона'),
    ).toBeInTheDocument();
    expect(within(block).queryByText('сезонная: сравнить пока не с чем')).not.toBeInTheDocument();
  });

  test('a seasonal theme with nothing compared has no word about a change', () => {
    answering(
      overviewOfRows(
        [placeOf({ stays_prev: 0 })],
        [themeOf({ theme: 'heating', seasonal: true, reviews: 20 })],
        SIX_MONTHS,
      ),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('Сравнить пока не с чем')).toBeInTheDocument();
    expect(within(block).queryByText(/перемена может быть/)).not.toBeInTheDocument();
  });

  test('a short window does not compare reviews, and says why', () => {
    answering(
      overviewOfRows(
        [placeOf({ stays: 60, stays_prev: 60 })],
        [themeOf({ reviews: 2, reviews_prev: 30 })],
        FOURTEEN_DAYS,
      ),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('Отзывы ещё приходят: сравнивать рано')).toBeInTheDocument();
    expect(screen.queryByText('Снижается')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('↓');
  });

  test('a short window still shows the staff’s trend, and names whose it is', () => {
    answering(
      overviewOfRows(
        [placeOf({ stays: 60, stays_prev: 60 })],
        [themeOf({ found: 20, found_prev: 5 })],
        FOURTEEN_DAYS,
      ),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('Растёт')).toBeInTheDocument();
    expect(within(block).getByText('по заданиям')).toHaveClass('sr-only');
  });

  test('a trend from reviews names its basis for a screen reader', () => {
    answering(overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], SIX_MONTHS));
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('по жалобам')).toHaveClass('sr-only');
  });

  test('a line the settled months have not reached holds nothing back', () => {
    answering(
      overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], {
        ...SIX_MONTHS,
        line: '2026-11-04',
      }),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('Растёт')).toBeInTheDocument();
  });

  test('a month still filling reads as no fall, and the trend says how far it reaches', () => {
    answering(
      overviewOfRows(
        [placeOf({ stays: 200, stays_settled: 100, stays_prev: 100 })],
        [themeOf({ reviews: 30, reviews_settled: 30, reviews_prev: 30 })],
        SIX_MONTHS,
      ),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(screen.queryByText('Снижается')).not.toBeInTheDocument();
    expect(within(block).getByText('Без явных перемен')).toBeInTheDocument();
    expect(
      within(block).getByText('Тренд по отзывам считается по 30.09: позже отзывы ещё приходят'),
    ).toBeInTheDocument();
  });

  test('counts and rates beside such a trend stay on the whole window', () => {
    answering(
      overviewOfRows(
        [placeOf({ stays: 200, stays_settled: 100, stays_prev: 100 })],
        [themeOf({ reviews: 30, reviews_settled: 10, reviews_prev: 30 })],
        SIX_MONTHS,
      ),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(within(block).getByText('30 жалоб')).toBeInTheDocument();
    expect(within(block).getByText('15 на 100 заездов (30 из 200)')).toBeInTheDocument();
  });

  test('a staff trend has no word about reviews still arriving', () => {
    answering(overviewOfRows([placeOf()], [themeOf({ found: 20, found_prev: 5 })], SIX_MONTHS));
    render(<QualityView />);

    expect(screen.queryByText(/Тренд по отзывам считается/)).not.toBeInTheDocument();
  });

  test('leads to the areas in the same window', () => {
    window.history.replaceState(null, '', '/quality?w=3m');
    render(<QualityView />);

    expect(screen.getByRole('link', { name: 'Области' })).toHaveAttribute(
      'href',
      '/quality/areas?w=3m',
    );
  });

  test('a comparison across the texts’ line is held back, with the day', () => {
    answering(
      overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], {
        ...SIX_MONTHS,
        settled_to: '2026-11-30',
        line: '2026-11-04',
      }),
    );
    render(<QualityView />);

    const block = screen.getByRole('region', { name: 'Главные темы портфеля' });
    expect(
      within(block).getByText('Отзывы до и после 04.11 читали по-разному: сравнивать рано'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Растёт')).not.toBeInTheDocument();
  });

  test('says a short window’s ratings are of three months', () => {
    answering(overviewOfRows([placeOf()], [], FOURTEEN_DAYS));
    render(<QualityView />);

    expect(screen.getByText(/Оценки за 3 месяца, с 1 сент\. 2026/)).toBeInTheDocument();
  });

  test('a long window needs no such word', () => {
    render(<QualityView />);

    expect(screen.queryByText(/Оценки за 3 месяца/)).not.toBeInTheDocument();
  });

  test('says that the last reviews of Booking may still come', () => {
    render(<QualityView />);

    expect(screen.getByText(/отзывы Booking могут ещё прийти/)).toBeInTheDocument();
  });
});

describe('QualityView: the table', () => {
  test('links a place to its card in the same window', () => {
    window.history.replaceState(null, '', '/quality?w=3m');
    answering(overviewOfRows([placeOf({ id: 7 })], [], { ...META, window: '3m' }));
    render(<QualityView />);

    expect(screen.getByRole('link', { name: 'Old Town flat' })).toHaveAttribute(
      'href',
      '/quality/7?w=3m',
    );
  });

  test('shows a place’s rating with its count, its stays and its trust', () => {
    render(<QualityView />);

    const row = screen.getByRole('row', { name: /Old Town flat/ });
    expect(within(row).getByText('8,8/10 (30)')).toBeInTheDocument();
    expect(within(row).getByText('100')).toBeInTheDocument();
    expect(within(row).getByText('Высокое')).toBeInTheDocument();
  });

  test('chips the themes of a place with the arrow of a trend, three at most', () => {
    answering(
      overviewOfRows(
        [placeOf()],
        [
          themeOf({ theme: 'wifi', reviews: 20, reviews_prev: 5, recent: 2 }),
          themeOf({ theme: 'tv', reviews: 2, recent: 1 }),
          themeOf({ theme: 'kettle', reviews: 2, recent: 1 }),
          themeOf({ theme: 'parking', reviews: 1, recent: 1 }),
        ],
        SIX_MONTHS,
      ),
    );
    render(<QualityView />);

    const row = screen.getByRole('row', { name: /Old Town flat/ });
    expect(within(row).getAllByRole('listitem')).toHaveLength(3);
    expect(within(row).getByText('Wi-Fi').textContent).toContain('↑');
    expect(within(row).getByText('Растёт по жалобам')).toHaveClass('sr-only');
    expect(within(row).queryByText('Парковка')).not.toBeInTheDocument();
  });

  test('writes out the states that ask for an answer: colour is not the only sign', () => {
    answering(
      overviewOfRows(
        [placeOf()],
        [
          themeOf({ theme: 'wifi', reviews: 2, recent: 2 }),
          themeOf({
            theme: 'tv',
            reviews: 1,
            recent: 1,
            last_on: '2026-10-19',
            closed_on: '2026-10-01',
          }),
          themeOf({ theme: 'kettle', reviews: 1, open_work: 1 }),
        ],
      ),
    );
    render(<QualityView />);

    const row = screen.getByRole('row', { name: /Old Town flat/ });
    for (const state of ['· Новое', '· Вернулось', '· В работе']) {
      expect(within(row).getByText(state)).not.toHaveClass('sr-only');
    }
  });

  test('keeps a quiet state for the reader alone, every word apart', () => {
    answering(
      overviewOfRows(
        [placeOf()],
        [themeOf({ reviews: 20, reviews_prev: 5, recent: 1, work_180: 1 })],
        SIX_MONTHS,
      ),
    );
    render(<QualityView />);

    const row = screen.getByRole('row', { name: /Old Town flat/ });
    const chip = within(row).getByText('Wi-Fi');
    expect(within(chip).getByText('Тихо')).toHaveClass('sr-only');
    expect(chip.textContent).toBe('Wi-Fi Тихо↑ Растёт по жалобам');
  });

  test('«только новое» leaves the places with a new theme, and says when there are none', () => {
    answering(
      overviewOfRows(
        [placeOf({ id: 1, name: 'New flat' }), placeOf({ id: 2, name: 'Old flat' })],
        [themeOf({ property_id: 1, reviews: 2, recent: 2 })],
      ),
    );
    render(<QualityView />);

    fireEvent.click(screen.getByRole('switch', { name: 'Только новое' }));

    expect(window.location.search).toBe('?new=1');
    expect(screen.getByRole('link', { name: 'New flat' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Old flat' })).not.toBeInTheDocument();
  });

  test('says so when nothing is new', () => {
    window.history.replaceState(null, '', '/quality?new=1');
    render(<QualityView />);

    expect(screen.getByText('Новых тем за этот период нет')).toBeInTheDocument();
  });
});

describe('QualityView: a city', () => {
  test('a company that does not group by city sees no filter, no group, no column', () => {
    window.history.replaceState(null, '', '/quality?city=Prague');
    answering(overviewOfRows(FIVE_FLATS, [themeOf({ property_id: 1, reviews: 3 })]));
    render(<QualityView />);

    expect(screen.queryByLabelText('Город')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Город' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Группа/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/группа не показывается/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(FIVE_FLATS.length + 1);
  });

  test('a company that does shows the filter and the column', () => {
    answering(overviewOfRows(FIVE_FLATS, [], byCity(META)));
    render(<QualityView />);

    expect(screen.getByLabelText('Город')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Город' })).toBeInTheDocument();
  });

  test('five places make a group, with its trend', () => {
    window.history.replaceState(null, '', '/quality?city=Prague');
    const flats = FIVE_FLATS.map((flat) => ({
      ...flat,
      stays: 30,
      stays_prev: 30,
      stays_settled: 30,
    }));
    answering(
      overviewOfRows(
        flats,
        flats.map((flat) => themeOf({ property_id: flat.id, reviews: 6, reviews_prev: 1 })),
        byCity(SIX_MONTHS),
      ),
    );
    render(<QualityView />);

    const group = screen.getByRole('region', { name: 'Группа: Prague' });
    expect(within(group).getByText('5 объектов, заездов: 150')).toBeInTheDocument();
    expect(within(group).getByText('Растёт')).toBeInTheDocument();
  });

  test('fewer make none, and the screen says why', () => {
    answering(
      overviewOfRows(
        [placeOf(), placeOf({ id: 2, name: 'Brno flat', city: 'Brno' })],
        [themeOf({ reviews: 3 })],
        byCity(META),
      ),
    );
    render(<QualityView />);

    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Brno' } });

    expect(window.location.search).toBe('?city=Brno');
    expect(screen.queryByRole('region', { name: /Группа/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('В городе Brno меньше 5 объектов: группа не показывается.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Brno flat' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Old Town flat' })).not.toBeInTheDocument();
  });
});

describe('QualityView: the reading of past reviews', () => {
  const rising = themeOf({ reviews: 20, reviews_prev: 5, recent: 2 });

  test('under way: a band with how far it is, and no trend anywhere', () => {
    answering(
      overviewOfRows([placeOf()], [rising], {
        ...SIX_MONTHS,
        history: { ...READ_HISTORY, weeks_done: 14, weeks_total: 49 },
      }),
    );
    render(<QualityView />);

    expect(screen.getByRole('status')).toHaveTextContent('Размечено 14 из 49 недель');
    expect(screen.queryByText('Растёт')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('↑');
  });

  test('under way with no total yet: the weeks done, nothing made up', () => {
    answering(
      overviewOfRows([placeOf()], [rising], {
        ...SIX_MONTHS,
        history: { ...READ_HISTORY, weeks_done: 3, weeks_total: null },
      }),
    );
    render(<QualityView />);

    expect(screen.getByRole('status')).toHaveTextContent('Размечено недель: 3.');
  });

  test('never started: a band that says what the themes come from', () => {
    answering(
      overviewOfRows([placeOf()], [rising], {
        ...SIX_MONTHS,
        history: { ...READ_HISTORY, enabled: false, weeks_done: 0, weeks_total: null },
      }),
    );
    render(<QualityView />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Прошлые отзывы ещё не прочитаны: темы идут только из находок и заданий.',
    );
    expect(screen.queryByText('Растёт')).not.toBeInTheDocument();
  });

  test('over: no band, and the trends are back', () => {
    answering(overviewOfRows([placeOf()], [rising], SIX_MONTHS));
    render(<QualityView />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Главные темы портфеля' })).getByText('Растёт'),
    ).toBeInTheDocument();
  });
});

describe('QualityView: stays that are not loaded', () => {
  test('are said, and no zero stands in for them', () => {
    answering(
      overviewOfRows([placeOf({ stays: 0, stays_prev: 0 })], [themeOf({ reviews: 3 })], NOT_READ),
    );
    render(<QualityView />);

    expect(screen.getByRole('status')).toHaveTextContent('Заезды за этот период ещё не загружены');
    const tiles = screen.getByRole('region', { name: 'Портфель за период' });
    const staysTile = within(tiles).getByText('Заезды').parentElement as HTMLElement;
    expect(within(staysTile).getByText('—')).toBeInTheDocument();
    expect(within(staysTile).queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(/на 100 заездов/)).not.toBeInTheDocument();
    expect(screen.getByText('3 жалобы')).toBeInTheDocument();
  });

  test('loaded from inside the window: the first month is said, and no rate stands on a part', () => {
    answering(
      overviewOfRows([placeOf()], [themeOf({ reviews: 3 })], {
        ...META,
        history: { ...READ_HISTORY, stays_from: '2026-06-01' },
      }),
    );
    render(<QualityView />);

    expect(screen.getByRole('status')).toHaveTextContent('Заезды загружены только с 1 июн. 2026');
    expect(screen.queryByText(/на 100 заездов/)).not.toBeInTheDocument();
  });

  test('a short window’s zero is a fact and stays a zero', () => {
    answering(overviewOfRows([placeOf({ stays: 0, stays_prev: 0 })], [], FOURTEEN_DAYS));
    render(<QualityView />);

    // The one band is the short window's own: nothing says the stays are not loaded.
    expect(screen.getByRole('status')).toHaveTextContent('В коротких периодах');
    expect(screen.getByText('Тем за этот период нет. Заездов: 0.')).toBeInTheDocument();
  });

  test('a short window with no bookings held says so, and shows no zero', () => {
    answering(
      overviewOfRows([placeOf()], [themeOf({ found: 3 })], { ...FOURTEEN_DAYS, held_from: null }),
    );
    render(<QualityView />);

    expect(screen.getByText(/Заезды за этот период ещё не загружены/)).toBeInTheDocument();
    const tiles = screen.getByRole('region', { name: 'Портфель за период' });
    const staysTile = within(tiles).getByText('Заезды').parentElement as HTMLElement;
    expect(within(staysTile).getByText('—')).toBeInTheDocument();
  });

  test('bookings held from inside a short window name that day', () => {
    answering(
      overviewOfRows([placeOf()], [themeOf({ found: 3 })], {
        ...FOURTEEN_DAYS,
        held_from: '2026-10-25',
      }),
    );
    render(<QualityView />);

    expect(screen.getByText(/Заезды загружены только с 25 окт\. 2026/)).toBeInTheDocument();
  });
});

describe('QualityView: a short window', () => {
  test('says that it cannot count every review', () => {
    answering({ ...overviewOfRows([placeOf()], []), ...FOURTEEN_DAYS });
    render(<QualityView />);

    expect(screen.getByText(/В коротких периодах видны не все отзывы/)).toBeInTheDocument();
  });

  test('a long window has nothing of the kind to say', () => {
    answering(overviewOfRows([placeOf()], []));
    render(<QualityView />);

    expect(screen.queryByText(/В коротких периодах видны не все отзывы/)).not.toBeInTheDocument();
  });
});

describe('QualityView: nothing to show', () => {
  test('no themes, with the stays they are said against', () => {
    answering(overviewOfRows([placeOf({ stays: 300 })], []));
    render(<QualityView />);

    expect(screen.getByText('Тем за этот период нет. Заездов: 300.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Главные темы портфеля' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Old Town flat' })).toBeInTheDocument();
  });

  test('no themes on stays not loaded does not count them', () => {
    answering(overviewOfRows([placeOf({ stays: 0, stays_prev: 0 })], [], NOT_READ));
    render(<QualityView />);

    expect(
      screen.getByText('Тем за этот период нет. Заезды ещё не загружены.'),
    ).toBeInTheDocument();
  });

  test('stays not loaded are not «nothing at all»', () => {
    answering(
      overviewOfRows(
        [placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null })],
        [],
        NOT_READ,
      ),
    );
    render(<QualityView />);

    expect(screen.getByText('Тем за этот период нет. Заезды ещё не загружены.')).toBeVisible();
    expect(screen.queryByText(/ни заездов, ни оценок/)).not.toBeInTheDocument();
  });

  test('a wrong shape leads with the screen’s words and dumps nothing', () => {
    state.read = {
      isError: true,
      error: new Error('The answer has an unexpected shape'),
    };
    render(<QualityView />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить качество объектов');
    expect(within(alert).getByText('The answer has an unexpected shape')).toHaveClass('text-xs');
  });

  test('no data at all', () => {
    answering(
      overviewOfRows(
        [placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null })],
        [],
        FOURTEEN_DAYS,
      ),
    );
    render(<QualityView />);

    expect(
      screen.getByText('За этот период данных нет: ни заездов, ни оценок, ни тем.'),
    ).toBeVisible();
  });

  test('no places at all', () => {
    answering(overviewOfRows([], []));
    render(<QualityView />);

    expect(screen.getByText('Объектов пока нет.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Объекты' })).not.toBeInTheDocument();
  });

  test('loading keeps the windows on the screen', () => {
    state.read = { isError: false, error: null };
    render(<QualityView />);

    expect(screen.getByRole('group', { name: 'Период' })).toBeInTheDocument();
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  test('a refusal is read in the reader’s language, without its English', () => {
    state.read = {
      isError: true,
      error: {
        message: 'A quality window is one of 14d, 1m, 3m, 6m, 12m, not x',
        hint: 'serverErrors.qualityWindowInvalid',
      },
    };
    render(<QualityView />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить качество объектов');
    expect(alert).toHaveTextContent('Такого периода в этом разделе нет');
    expect(alert).not.toHaveTextContent('A quality window');
  });
});

describe('QualityView in the panel’s other languages', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('ru');
  });

  test.each([
    ['en', 'Property quality', '3 complaints · 2 found · 1 filed', '4 per 100 stays (3 of 76)'],
    ['cs', 'Kvalita objektů', '3 stížnosti · 2 nálezy · 1 záznam', '4 na 100 pobytů (3 z 76)'],
  ])('%s reads it in its own words', async (language, title, layers, rate) => {
    await i18n.changeLanguage(language);
    answering(
      overviewOfRows(
        [placeOf({ stays: 76 })],
        [themeOf({ reviews: 3, found: 2, reported: 1, recent: 1 })],
      ),
    );
    render(<QualityView />);

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(layers)).toBeInTheDocument();
    expect(screen.getByText(rate)).toBeInTheDocument();
  });
});
