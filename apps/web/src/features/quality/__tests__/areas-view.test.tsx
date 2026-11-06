import type { QualityWindow } from '@str-ops/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';

import {
  areasSchema,
  type QualityAreaMember,
  type QualityAreas,
  type QualityOverview,
} from '../schema';
import {
  FOURTEEN_DAYS,
  META,
  overviewOfRows,
  placeOf,
  READ_HISTORY,
  SIX_MONTHS,
  themeOf,
} from './fixtures';

interface Read<T> {
  data?: T;
  isError: boolean;
  error: unknown;
}

const state: {
  areas: Read<QualityAreas>;
  overview: Read<QualityOverview>;
  asked: QualityWindow[];
} = {
  areas: { isError: false, error: null },
  overview: { isError: false, error: null },
  asked: [],
};

vi.mock('../use-quality', () => ({
  useQualityAreas: (window: QualityWindow) => {
    state.asked.push(window);
    return state.areas;
  },
  useQualityOverview: () => state.overview,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { AreasView } from '../areas-view';

function memberOf(over: Partial<QualityAreaMember> = {}): QualityAreaMember {
  return {
    theme: 'wifi',
    property_id: 7,
    name: 'Old Town flat',
    basis: 'guest',
    episodes: 3,
    stays: 40,
    ...over,
  };
}

function answering(
  members: readonly QualityAreaMember[],
  overview: QualityOverview = overviewOfRows([placeOf({ stays: 300 })], []),
  computedOn: string | null = '2026-11-05',
): void {
  state.areas = {
    data: { window: '12m', computed_on: computedOn, members: [...members] },
    isError: false,
    error: null,
  };
  state.overview = { data: overview, isError: false, error: null };
}

const area = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  window.history.replaceState(null, '', '/quality/areas');
  state.asked = [];
  answering([memberOf()]);
});

describe('AreasView: the frame of the screen', () => {
  test('names itself, says the rule, and leads back in the same window', () => {
    window.history.replaceState(null, '', '/quality/areas?w=3m');
    render(<AreasView />);

    expect(screen.getByRole('heading', { level: 1, name: 'Области' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Объект входит в область, если тема у него заметно чаще, чем у остальных: не меньше двух упоминаний при достаточном числе заездов. Состав пересчитывается ночью и зависит от периода.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Качество объектов' })).toHaveAttribute(
      'href',
      '/quality?w=3m',
    );
  });

  test('opens on twelve months, and a window changed goes into the address', () => {
    render(<AreasView />);
    expect(screen.getByRole('button', { name: '12 месяцев' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: '6 месяцев' }));

    expect(window.location.search).toBe('?w=6m');
    expect(state.asked.at(-1)).toBe('6m');
  });

  test('says when the night counted it', () => {
    render(<AreasView />);

    expect(screen.getByText('Посчитано 05.11')).toBeInTheDocument();
  });

  test('offers nothing to press but the windows', () => {
    render(<AreasView />);

    expect(screen.getAllByRole('button')).toHaveLength(5);
  });
});

describe('AreasView: an area', () => {
  test('shows the theme, how many listings, and each listing as a link with its numbers', () => {
    window.history.replaceState(null, '', '/quality/areas?w=3m');
    answering(
      [
        memberOf({ property_id: 7, name: 'Old Town flat', episodes: 3, stays: 40 }),
        memberOf({ property_id: 8, name: 'River house', basis: 'staff', episodes: 2, stays: 21 }),
      ],
      overviewOfRows([placeOf()], [], { ...META, window: '3m' }),
    );
    render(<AreasView />);

    const wifi = area('Wi-Fi');
    expect(within(wifi).getByText('2 объекта')).toBeInTheDocument();
    expect(within(wifi).getByRole('link', { name: 'Old Town flat' })).toHaveAttribute(
      'href',
      '/quality/7?w=3m',
    );
    expect(within(wifi).getByText('3 из 40 заездов · гости')).toBeInTheDocument();
    expect(within(wifi).getByText('2 из 21 заезда · сотрудники')).toBeInTheDocument();
  });

  test('orders the areas by how many places stand in them', () => {
    answering([
      memberOf({ theme: 'heating', property_id: 1 }),
      memberOf({ theme: 'parking', property_id: 2 }),
      memberOf({ theme: 'parking', property_id: 3 }),
    ]);
    render(<AreasView />);

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Парковка', 'Отопление']);
  });

  test('a place on both sides stands once, with both lines and no sum', () => {
    answering([
      memberOf({ basis: 'guest', episodes: 3, stays: 40 }),
      memberOf({ basis: 'staff', episodes: 2, stays: 40 }),
    ]);
    render(<AreasView />);

    const wifi = area('Wi-Fi');
    expect(within(wifi).getAllByRole('link', { name: 'Old Town flat' })).toHaveLength(1);
    expect(within(wifi).getByText('1 объект')).toBeInTheDocument();
    expect(within(wifi).getByText('3 из 40 заездов · гости')).toBeInTheDocument();
    expect(within(wifi).getByText('2 из 40 заездов · сотрудники')).toBeInTheDocument();
    expect(wifi.textContent).not.toMatch(/5 из 40/);
  });

  test('a theme this build does not know leaves the screen standing, without it', () => {
    state.areas = {
      data: areasSchema.parse({
        window: '12m',
        computed_on: '2026-11-05',
        members: [memberOf(), { ...memberOf(), theme: 'teleport' }],
      }),
      isError: false,
      error: null,
    };
    render(<AreasView />);

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(document.body.textContent).not.toContain('teleport');
  });
});

describe('AreasView: the dynamics', () => {
  test('are the overview’s, with its caption, and say whose they are', () => {
    answering(
      [memberOf()],
      overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], SIX_MONTHS),
    );
    render(<AreasView />);

    const wifi = area('Wi-Fi');
    expect(within(wifi).getByText('Растёт')).toBeInTheDocument();
    expect(within(wifi).getByText('по жалобам')).toHaveClass('sr-only');
    expect(
      within(wifi).getByText('Тренд по отзывам считается по 30.09: позже отзывы ещё приходят'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Динамика по всем объектам, не только по составу области'),
    ).toBeInTheDocument();
  });

  test('come from every place: a member high enough to stand here does not make them fall', () => {
    answering(
      [memberOf({ property_id: 1, episodes: 30, stays: 40 })],
      overviewOfRows(
        [placeOf({ id: 1 }), placeOf({ id: 2 })],
        [
          themeOf({ property_id: 1, reviews: 2, reviews_prev: 30 }),
          themeOf({ property_id: 2, reviews: 70, reviews_prev: 2 }),
        ],
        SIX_MONTHS,
      ),
    );
    render(<AreasView />);

    expect(within(area('Wi-Fi')).getByText('Растёт')).toBeInTheDocument();
    expect(screen.queryByText('Снижается')).not.toBeInTheDocument();
  });

  test('carry the same reasons the overview gives', () => {
    answering(
      [memberOf()],
      overviewOfRows([placeOf()], [themeOf({ reviews: 2, reviews_prev: 30 })], FOURTEEN_DAYS),
    );
    render(<AreasView />);

    expect(
      within(area('Wi-Fi')).getByText('Отзывы ещё приходят: сравнивать рано'),
    ).toBeInTheDocument();
  });

  test('say nothing when the theme left the overview since the night', () => {
    render(<AreasView />);

    expect(within(area('Wi-Fi')).queryByText(/Сравнить|Растёт/)).not.toBeInTheDocument();
  });

  test('wait for the reading of past reviews, as everywhere', () => {
    answering(
      [memberOf()],
      overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], {
        ...SIX_MONTHS,
        history: { ...READ_HISTORY, weeks_done: 14, weeks_total: 49 },
      }),
    );
    render(<AreasView />);

    expect(screen.getByRole('status')).toHaveTextContent('Размечено 14 из 49 недель');
    expect(within(area('Wi-Fi')).getByText('Тренд скрыт до конца разметки')).toBeInTheDocument();
  });
});

describe('AreasView: nothing to show', () => {
  test('the night has not come yet', () => {
    answering([], undefined, null);
    render(<AreasView />);

    expect(screen.getByText('Области ещё не считались: они считаются ночью')).toBeInTheDocument();
    expect(screen.queryByText(/^Посчитано/)).not.toBeInTheDocument();
  });

  test('stays not loaded for this window', () => {
    answering(
      [memberOf()],
      overviewOfRows([placeOf()], [], { ...META, history: { ...READ_HISTORY, stays_from: null } }),
    );
    render(<AreasView />);

    expect(
      screen.getByText('Заезды за этот период ещё не загружены: считать области не на чем'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Old Town flat' })).not.toBeInTheDocument();
    expect(screen.getByText('Посчитано 05.11')).toBeInTheDocument();
  });

  test('counted and empty, with the stays it was counted on', () => {
    answering([]);
    render(<AreasView />);

    expect(
      screen.getByText('За этот период ни одна тема не выделяется. Заездов: 300.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Динамика по всем объектам/)).not.toBeInTheDocument();
  });

  test('loading waits for both reads, and keeps the windows', () => {
    state.overview = { isError: false, error: null };
    render(<AreasView />);

    expect(screen.getByRole('group', { name: 'Период' })).toBeInTheDocument();
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Wi-Fi' })).not.toBeInTheDocument();
  });

  test.each(['areas', 'overview'] as const)('a failure of the %s read is the screen’s', (read) => {
    state[read] = { isError: true, error: new Error('connection reset') };
    render(<AreasView />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить области');
    expect(within(alert).getByText('connection reset')).toHaveClass('text-xs');
  });

  test('a wrong shape leads with the screen’s words and dumps nothing', () => {
    state.areas = {
      isError: true,
      error: new Error('The answer has an unexpected shape'),
    };
    render(<AreasView />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить области');
    expect(within(alert).getByText('The answer has an unexpected shape')).toHaveClass('text-xs');
    expect(alert.textContent).not.toMatch(/[{}[\]]/);
  });
});

describe('AreasView in the panel’s other languages', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('ru');
  });

  test.each([
    ['en', 'Theme areas', '3 of 40 stays · guests', '1 property'],
    ['cs', 'Oblasti témat', '3 z 40 pobytů · hosté', '1 objekt'],
  ])('%s reads it in its own words', async (language, title, member, count) => {
    await i18n.changeLanguage(language);
    render(<AreasView />);

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(member)).toBeInTheDocument();
    expect(screen.getByText(count)).toBeInTheDocument();
  });
});
