import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { effectRows, lastYearRate, planEffectSchema, type EffectTheme, type PlanEffect } from '../effect-model';

const state: { read: { data?: PlanEffect; isError: boolean; error: unknown } } = {
  read: { isError: false, error: null },
};

vi.mock('../use-plans', () => ({ usePlanEffect: () => state.read }));

import { EffectBlock } from '../effect-block';

function theme(over: Partial<EffectTheme> = {}): EffectTheme {
  return {
    theme: 'wifi',
    seasonal: false,
    before: { reviews: 6, found: 0, reported: 1 },
    after: { reviews: 1, found: 0, reported: 0 },
    work_after: 2,
    last_year: null,
    ...over,
  };
}

function effect(over: Partial<NonNullable<PlanEffect>> = {}): NonNullable<PlanEffect> {
  return {
    closed_on: '2026-11-10',
    launched_on: '2026-11-01',
    stays_before: 120,
    stays_after: 40,
    themes: [theme()],
    ...over,
  };
}

function open(data: PlanEffect): void {
  state.read = { data, isError: false, error: null };
  render(<EffectBlock planId="11111111-1111-4111-8111-111111111111" />);
}

beforeEach(() => {
  state.read = { isError: false, error: null };
});

describe('the model', () => {
  test('a layer nobody speaks of takes no line', () => {
    expect(effectRows(theme(), 120, 40).map((row) => row.layer)).toEqual(['reviews', 'reported']);
  });

  test('rates stand on their own stays', () => {
    const [reviews] = effectRows(theme(), 120, 40);

    expect(reviews).toMatchObject({ before: 6, after: 1, rateBefore: 5, rateAfter: 2.5 });
  });

  test('no stays before, no rate before', () => {
    expect(effectRows(theme(), null, 40)[0].rateBefore).toBeNull();
  });

  test('last year adds its layers and reads them against its stays', () => {
    const year = { reviews: 2, found: 1, reported: 1, stays: 40 };

    expect(lastYearRate(theme({ last_year: year }))).toBe(10);
  });

  test('a year with no stays says nothing', () => {
    const year = { reviews: 0, found: 0, reported: 0, stays: 0 };

    expect(lastYearRate(theme({ last_year: year }))).toBeNull();
  });

  test('reads what the function answers, and null for a plan not finished', () => {
    expect(planEffectSchema.parse(null)).toBeNull();
    expect(planEffectSchema.parse(effect())).not.toBeNull();
  });
});

describe('EffectBlock', () => {
  test('under thirty stays it concludes nothing and says how far it has come', () => {
    open(effect({ stays_after: 12 }));

    expect(screen.getByText(/Пока мало заездов: 12 из 30/)).toBeInTheDocument();
    expect(screen.queryByText('Wi-Fi')).not.toBeInTheDocument();
  });

  test('from thirty it shows the same theme before and after, each with its numbers', () => {
    open(effect());

    expect(screen.getByRole('heading', { name: 'Wi-Fi' })).toBeInTheDocument();
    expect(screen.getByText('5 на 100 заездов (6 из 120)')).toBeInTheDocument();
    expect(screen.getByText('3 на 100 заездов (1 из 40)')).toBeInTheDocument();
  });

  test('tasks and reviews stand on separate lines', () => {
    open(effect());

    expect(screen.getByText('Новых заданий по теме: 2')).toBeInTheDocument();
  });

  test('it speaks of coincidence and of nothing being proved', () => {
    open(effect());

    expect(screen.getByText(/совпадение по времени/)).toBeInTheDocument();
    expect(screen.queryByText(/решил|из-за|причин/i)).not.toBeInTheDocument();
  });

  test('a seasonal theme says the season is the real test', () => {
    const year = { reviews: 3, found: 0, reported: 1, stays: 40 };
    open(effect({ themes: [theme({ theme: 'heating', seasonal: true, last_year: year })] }));

    expect(screen.getByText(/Тема сезонная/)).toBeInTheDocument();
    expect(screen.getByText(/10 на 100/)).toBeInTheDocument();
  });

  test('a seasonal theme with no last year says so', () => {
    const year = { reviews: 0, found: 0, reported: 0, stays: 0 };
    open(effect({ themes: [theme({ theme: 'heating', seasonal: true, last_year: year })] }));

    expect(screen.getByText(/за прошлый год данных нет/)).toBeInTheDocument();
  });

  test('a theme with no episode on either side says so', () => {
    const silent = { reviews: 0, found: 0, reported: 0 };
    open(effect({ themes: [theme({ before: silent, after: silent })] }));

    expect(screen.getByText('Эпизодов по теме нет ни до, ни после')).toBeInTheDocument();
  });

  test('a plan not finished shows nothing', () => {
    open(null);

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
