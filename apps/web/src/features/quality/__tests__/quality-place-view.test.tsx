import type { QualityWindow } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { QualityPlaceCard } from '../schema';
import { cardOf, FOURTEEN_DAYS, placeOf, READ_HISTORY, SIX_MONTHS, themeOf } from './fixtures';

const state: {
  read: { data?: QualityPlaceCard | null; isError: boolean; error: unknown };
  asked: { placeId: number; window: QualityWindow }[];
} = { read: { isError: false, error: null }, asked: [] };

vi.mock('../use-quality', () => ({
  useQualityPlace: (placeId: number, window: QualityWindow) => {
    state.asked.push({ placeId, window });
    return state.read;
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { QualityPlaceView } from '../quality-place-view';

function answering(data: QualityPlaceCard | null): void {
  state.read = { data, isError: false, error: null };
}

function openCard(): void {
  render(<QualityPlaceView placeId={7} />);
}

const important = () => screen.getByRole('region', { name: 'Что важно сейчас' });

beforeEach(() => {
  window.history.replaceState(null, '', '/quality/7');
  state.asked = [];
  answering(cardOf());
});

describe('QualityPlaceView: the head of the card', () => {
  test('names the place, the numbers of the window and how far they can be trusted', () => {
    answering(cardOf({ place: placeOf({ stays: 76, rating_n: 41, rating_avg: 8.72 }) }));
    openCard();

    expect(screen.getByRole('heading', { level: 1, name: 'Old Town flat' })).toBeInTheDocument();
    expect(screen.getByText('Prague')).toBeInTheDocument();
    expect(screen.getByText('Заезды:').nextSibling).toHaveTextContent('76');
    expect(screen.getByText('Отзывы с оценкой:').nextSibling).toHaveTextContent('41');
    expect(screen.getByText('Оценка:').nextSibling).toHaveTextContent('8,7');
    expect(screen.getByText('Доверие:').nextSibling).toHaveTextContent('Высокое');
  });

  test('asks for the place in the address’s window, and the way back keeps it', () => {
    window.history.replaceState(null, '', '/quality/7?w=3m');
    openCard();

    expect(state.asked.at(-1)).toEqual({ placeId: 7, window: '3m' });
    expect(screen.getByRole('link', { name: 'Качество объектов' })).toHaveAttribute(
      'href',
      '/quality?w=3m',
    );
  });

  test('opens on twelve months, and a window changed goes into the address', () => {
    openCard();
    expect(screen.getByRole('button', { name: '12 месяцев' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: '6 месяцев' }));

    expect(window.location.search).toBe('?w=6m');
    expect(state.asked.at(-1)).toEqual({ placeId: 7, window: '6m' });
  });

  test('offers nothing to write: no plan, no accepting, no editing of themes', () => {
    answering(cardOf({ themes: [themeOf({ reviews: 2, recent: 2 })] }));
    openCard();

    const pressable = screen.getAllByRole('button').map((button) => button.textContent);
    expect(pressable).toEqual(['14 дней', '1 месяц', '3 месяца', '6 месяцев', '12 месяцев']);
  });
});

describe('QualityPlaceView: a theme', () => {
  test('shows its state, its layers, its rate with the numbers, and its trend', () => {
    answering(
      cardOf({
        ...SIX_MONTHS,
        place: placeOf({ stays: 76, stays_prev: 80 }),
        themes: [
          themeOf({
            reviews: 16,
            reviews_prev: 3,
            found: 2,
            recent: 3,
            last_on: '2026-10-19',
            closed_on: '2026-10-01',
          }),
        ],
      }),
    );
    openCard();

    const block = important();
    expect(within(block).getByRole('heading', { name: 'Wi-Fi' })).toBeInTheDocument();
    expect(within(block).getByText('Вернулось')).toBeInTheDocument();
    expect(within(block).getByText('16 жалоб · 2 находки')).toBeInTheDocument();
    expect(within(block).getByText('21 на 100 заездов (16 из 76)')).toBeInTheDocument();
    expect(within(block).getByText('Растёт')).toBeInTheDocument();
    expect(within(block).getByText('Работа закрыта 01.10')).toBeInTheDocument();
  });

  test('no rate below twenty stays: the count, and why', () => {
    answering(
      cardOf({
        place: placeOf({ stays: 19 }),
        themes: [themeOf({ reviews: 3, recent: 3 })],
      }),
    );
    openCard();

    expect(screen.queryByText(/на 100 заездов/)).not.toBeInTheDocument();
    expect(screen.getByText('3 жалобы')).toBeInTheDocument();
    expect(screen.getByText('Мало заездов: меньше 20, только счётчик')).toBeInTheDocument();
  });

  test('from twenty stays there is one', () => {
    answering(
      cardOf({
        place: placeOf({ stays: 20 }),
        themes: [themeOf({ reviews: 3, recent: 3 })],
      }),
    );
    openCard();

    expect(screen.getByText('15 на 100 заездов (3 из 20)')).toBeInTheDocument();
  });

  test('no rate in a short window at a place, whatever its stays', () => {
    answering(
      cardOf({
        ...FOURTEEN_DAYS,
        place: placeOf({ stays: 60 }),
        themes: [themeOf({ reviews: 3, recent: 3 })],
      }),
    );
    openCard();

    expect(screen.queryByText(/на 100 заездов/)).not.toBeInTheDocument();
    expect(screen.getByText('Период короткий: только счётчик')).toBeInTheDocument();
  });

  test('no trend below forty stays: grey, without an arrow, and the reason', () => {
    answering(
      cardOf({
        ...SIX_MONTHS,
        place: placeOf({ stays: 100, stays_prev: 39 }),
        themes: [themeOf({ reviews: 20, reviews_prev: 1, recent: 2 })],
      }),
    );
    openCard();

    expect(screen.queryByText('Растёт')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('↑');
    expect(screen.getByText('Мало данных', { selector: '[data-slot], span' })).toBeInTheDocument();
    expect(screen.getByText('меньше 40 заездов хотя бы в одном периоде')).toBeInTheDocument();
  });

  test('a seasonal theme has nothing to compare with yet', () => {
    answering(
      cardOf({
        ...SIX_MONTHS,
        themes: [themeOf({ theme: 'heating', seasonal: true, reviews: 2, recent: 2 })],
      }),
    );
    openCard();

    expect(within(important()).getByText('сезонная: сравнить пока не с чем')).toBeInTheDocument();
  });

  test('twelve months have no window before yet, and the card says so', () => {
    answering(
      cardOf({
        place: placeOf({ stays_prev: 0 }),
        themes: [themeOf({ reviews: 2, recent: 2 })],
      }),
    );
    openCard();

    expect(within(important()).getByText('Сравнить пока не с чем')).toBeInTheDocument();
  });

  test('a trend waits for the reading of past reviews, and says it does', () => {
    answering(
      cardOf({
        ...SIX_MONTHS,
        history: { ...READ_HISTORY, weeks_done: 14, weeks_total: 49 },
        themes: [themeOf({ reviews: 20, reviews_prev: 5, recent: 2 })],
      }),
    );
    openCard();

    expect(screen.getByRole('status')).toHaveTextContent('Размечено 14 из 49 недель');
    expect(screen.getByText('Тренд скрыт до конца разметки')).toBeInTheDocument();
    expect(screen.queryByText('Растёт')).not.toBeInTheDocument();
  });

  test('live work on a theme is said under it', () => {
    answering(cardOf({ themes: [themeOf({ reviews: 1, open_work: 2 })] }));
    openCard();

    const block = screen.getByRole('region', { name: 'Остальные темы' });
    expect(within(block).getByText('В работе', { selector: 'span' })).toBeInTheDocument();
    expect(within(block).getByText('В работе: 2')).toBeInTheDocument();
  });

  test('a theme with live work and nothing said in the window says that too', () => {
    answering(cardOf({ themes: [themeOf({ open_work: 1, reviews_prev: 2 })] }));
    openCard();

    expect(screen.getByText('За этот период упоминаний нет')).toBeInTheDocument();
  });
});

describe('QualityPlaceView: the blocks', () => {
  test('what is not new, returned or growing stands below, and the top says it is empty', () => {
    answering(cardOf({ themes: [themeOf({ reviews: 1, recent: 1 })] }));
    openCard();

    expect(within(important()).getByText('Нового, вернувшегося и растущего нет.')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Остальные темы' })).getByText('Wi-Fi'),
    ).toBeInTheDocument();
  });

  test('says how far repairs are on record, above the old episodes', () => {
    answering(
      cardOf({
        work_from: '2026-10-19',
        themes: [themeOf({ reviews: 1, last_on: '2026-03-01' })],
      }),
    );
    openCard();

    expect(screen.getByText('До 19.10 записей о ремонтах нет')).toBeInTheDocument();
    expect(screen.getByText('Нет данных о ремонтах')).toBeInTheDocument();
  });

  test('no word about repairs when no episode is older than them', () => {
    answering(
      cardOf({
        work_from: '2026-10-19',
        themes: [themeOf({ reviews: 1, recent: 1, last_on: '2026-10-19' })],
      }),
    );
    openCard();

    expect(screen.queryByText(/записей о ремонтах нет/)).not.toBeInTheDocument();
  });
});

describe('QualityPlaceView: the months', () => {
  test('draws a figure, and gives its numbers in words', () => {
    answering(
      cardOf({
        months: [
          { month: '2026-09-01', theme: 'wifi', layer: 'guest_review', n: 3 },
          { month: '2026-09-01', theme: 'tv', layer: 'guest_review', n: 1 },
          { month: '2026-10-01', theme: 'wifi', layer: 'staff_report', n: 2 },
        ],
      }),
    );
    openCard();

    const table = screen.getByRole('table', { name: 'По месяцам, последние 12 месяцев' });
    const september = within(table).getByRole('row', { name: /сентябрь 2026/ });
    expect(
      within(september)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['4', '0', '0']);
    expect(document.querySelector('figure svg')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelectorAll('figure svg title')).toHaveLength(2);
  });

  test('says so when the year is silent', () => {
    openCard();

    expect(screen.getByText('За последние 12 месяцев упоминаний нет.')).toBeInTheDocument();
    expect(document.querySelector('figure svg')).toBeNull();
  });
});

describe('QualityPlaceView: the ratings', () => {
  const rated = cardOf({
    channels: [
      { channel: 'airbnb', n: 12, average: 9.25 },
      { channel: 'booking', n: 5, average: 8.1 },
    ],
    categories: [
      { key: 'cleanliness', n: 12, average: 9, city_n: 40, city_average: 8.8 },
      { key: 'location', n: 3, average: 7.5, city_n: 0, city_average: null },
    ],
  });
  const block = () => screen.getByRole('region', { name: 'Оценки' });

  test('keeps each channel apart, with its reviews, and no mean of them', () => {
    answering(rated);
    openCard();

    expect(within(block()).getByRole('row', { name: /Airbnb/ })).toHaveTextContent('9,3/10 (12)');
    expect(within(block()).getByRole('row', { name: /Booking\.com/ })).toHaveTextContent(
      '8,1/10 (5)',
    );
    expect(
      within(block()).getByText('Каналы не усредняются между собой: шкалы у них разные.'),
    ).toBeVisible();
  });

  test('sets a category beside the city, with n on both sides', () => {
    answering(rated);
    openCard();

    const row = within(block()).getByRole('row', { name: /cleanliness|чистота/i });
    expect(row).toHaveTextContent('9/10 (12)');
    expect(row).toHaveTextContent('8,8/10 (40)');
    expect(within(block()).getByRole('columnheader', { name: 'Prague' })).toBeInTheDocument();
  });

  test('has nothing to say of a city nobody rated', () => {
    answering(rated);
    openCard();

    const row = within(block()).getByRole('row', { name: /расположение/i });
    expect(within(row).getAllByRole('cell').at(-1)).toHaveTextContent('—');
  });

  test('labels the ratings of a short window', () => {
    answering({ ...rated, ...FOURTEEN_DAYS });
    openCard();

    expect(within(block()).getByText(/Оценки за 3 месяца, с 1 сент\. 2026/)).toBeInTheDocument();
  });

  test('says so when nobody rated', () => {
    openCard();

    expect(within(block()).getByText('Оценок за этот период нет.')).toBeInTheDocument();
  });
});

describe('QualityPlaceView: nothing to show', () => {
  test('a place the company has not got is an honest not-found, with the way back', () => {
    answering(null);
    openCard();

    expect(screen.getByRole('heading', { name: 'Объект не найден' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Качество объектов' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Период' })).not.toBeInTheDocument();
  });

  test('no themes, with the stays they are said against', () => {
    answering(cardOf({ place: placeOf({ stays: 300 }) }));
    openCard();

    expect(screen.getByText('Тем за этот период нет. Заездов: 300.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Что важно сейчас' })).not.toBeInTheDocument();
  });

  test('no themes on stays not loaded does not count them', () => {
    answering(
      cardOf({
        history: { ...READ_HISTORY, stays_from: null, stay_months: 0 },
        place: placeOf({ stays: 0, stays_prev: 0 }),
      }),
    );
    openCard();

    expect(screen.getByRole('status')).toHaveTextContent('Заезды за этот период ещё не загружены');
    expect(screen.getByText('Тем за этот период нет. Заезды ещё не загружены.')).toBeVisible();
    expect(screen.getByText('Заезды:').nextSibling).toHaveTextContent('—');
  });

  test('no data at all', () => {
    answering(
      cardOf({
        ...FOURTEEN_DAYS,
        place: placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null }),
      }),
    );
    openCard();

    expect(screen.getByText('По этому объекту за этот период данных нет.')).toBeInTheDocument();
  });

  test('loading keeps the way back and the windows', () => {
    state.read = { isError: false, error: null };
    openCard();

    expect(screen.getByRole('link', { name: 'Качество объектов' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Период' })).toBeInTheDocument();
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  test('a failure leads with the screen’s words, the server’s stay small', () => {
    state.read = { isError: true, error: new Error('connection reset') };
    openCard();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить карточку объекта');
    expect(within(alert).getByText('connection reset')).toHaveClass('text-xs');
  });
});
