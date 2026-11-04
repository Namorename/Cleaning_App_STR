import { describe, expect, test } from 'vitest';

import { fetchReviewPage, REVIEWS_PAGE_SIZE } from '../api';
import {
  anyCategoryLow,
  departureBounds,
  EMPTY_REVIEW_FILTERS,
  findingStatusesOf,
  hasReviewFilters,
  nextMonthStart,
  readGuestsAddress,
  recentMonths,
  withOrderedBounds,
  writeGuestsAddress,
  type ReviewFilters,
} from '../review-filters';

const EVERYTHING: ReviewFilters = {
  channels: ['airbnb', 'booking'],
  placeIds: [7, 40],
  ratingMin: 2,
  ratingMax: 6,
  monthFrom: '2025-11',
  monthTo: '2026-10',
  withText: true,
  withPrivate: true,
  hiddenOnly: true,
  lowCategory: 'cleanliness',
  findings: ['found', 'linked'],
};

describe('the address of «Гости»', () => {
  test('every filter goes into the address and comes back out as it was', () => {
    const written = writeGuestsAddress({ tab: 'all', reviews: EVERYTHING });

    expect(written).toBe(
      'tab=all&channel=airbnb%2Cbooking&place=7%2C40&rmin=2&rmax=6&from=2025-11&to=2026-10' +
        '&text=1&private=1&hidden=1&low=cleanliness&finding=found%2Clinked',
    );
    expect(readGuestsAddress(new URLSearchParams(written))).toEqual({
      tab: 'all',
      reviews: EVERYTHING,
    });
  });

  test('the defaults write nothing, and the bare page opens «Найдено» with no filters', () => {
    expect(writeGuestsAddress({ tab: 'found', reviews: EMPTY_REVIEW_FILTERS })).toBe('');
    expect(readGuestsAddress(new URLSearchParams(''))).toEqual({
      tab: 'found',
      reviews: EMPTY_REVIEW_FILTERS,
    });
  });

  test('a hand-edited link loses what makes no sense and keeps the rest', () => {
    const read = readGuestsAddress(
      new URLSearchParams(
        'tab=nope&channel=airbnb,google,airbnb&place=7,-1,x&rmin=11&rmax=6&from=2026-13&low=dust&finding=found,dropped&text=yes',
      ),
    );

    expect(read).toEqual({
      tab: 'found',
      reviews: {
        ...EMPTY_REVIEW_FILTERS,
        channels: ['airbnb'],
        placeIds: [7],
        ratingMax: 6,
        findings: ['found'],
      },
    });
  });
});

describe('the filters themselves', () => {
  test('a filter is a filter; the empty set is none', () => {
    expect(hasReviewFilters(EMPTY_REVIEW_FILTERS)).toBe(false);
    expect(hasReviewFilters({ ...EMPTY_REVIEW_FILTERS, hiddenOnly: true })).toBe(true);
  });

  test('a range typed the wrong way round is read the right way round', () => {
    expect(
      withOrderedBounds({
        ...EMPTY_REVIEW_FILTERS,
        ratingMin: 8,
        ratingMax: 2,
        monthFrom: '2026-10',
        monthTo: '2026-01',
      }),
    ).toEqual({
      ...EMPTY_REVIEW_FILTERS,
      ratingMin: 2,
      ratingMax: 8,
      monthFrom: '2026-01',
      monthTo: '2026-10',
    });
    expect(withOrderedBounds(EVERYTHING)).toBe(EVERYTHING);
  });

  test('a period of months covers whole months, across the turn of the year', () => {
    expect(nextMonthStart('2026-12')).toBe('2027-01-01');
    expect(
      departureBounds({ ...EMPTY_REVIEW_FILTERS, monthFrom: '2025-11', monthTo: '2026-02' }),
    ).toEqual({
      from: '2025-11-01',
      before: '2026-03-01',
    });
    expect(departureBounds(EMPTY_REVIEW_FILTERS)).toEqual({ from: null, before: null });
  });

  test('the months offered go back from this one, through the year before', () => {
    expect(recentMonths('2026-02-15', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });

  test('«Привязаны» stands for both of its statuses', () => {
    expect(findingStatusesOf({ ...EMPTY_REVIEW_FILTERS, findings: ['found', 'linked'] })).toEqual([
      'candidate',
      'duplicate',
      'already_fixed',
    ]);
  });

  test('«any category low» asks every category, as numbers in the JSON', () => {
    expect(anyCategoryLow().split(',')).toHaveLength(9);
    expect(anyCategoryLow()).toContain('category_ratings->cleanliness.lte.6');
  });
});

/** Records every call a reader makes on the query, and answers with no rows. */
function recordingClient(answer: { error?: { code: string } | null; count?: number } = {}) {
  const calls: [string, ...unknown[]][] = [];
  const result = Promise.resolve({
    data: answer.error ? null : [],
    error: answer.error ?? null,
    count: answer.count ?? 0,
  });
  const builder: Record<string, unknown> = {
    then: result.then.bind(result),
    catch: result.catch.bind(result),
  };
  for (const name of ['select', 'eq', 'in', 'gte', 'lte', 'lt', 'or', 'order', 'range']) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  }
  const from = (table: string) => {
    calls.push(['from', table]);
    return builder;
  };
  return { client: { from } as never, calls };
}

describe('one page of «Все отзывы» is asked of the server', () => {
  test('no filter: the reviews only, newest first, the first fifty and their count', async () => {
    const { client, calls } = recordingClient({ count: 5123 });

    const page = await fetchReviewPage(client, EMPTY_REVIEW_FILTERS, 0);

    expect(page).toEqual({ reviews: [], total: 5123 });
    expect(calls[0]).toEqual(['from', 'guest_signals']);
    const select = calls.find(([name]) => name === 'select');
    expect(select?.[1]).not.toContain('signal_findings');
    expect(select?.[2]).toEqual({ count: 'exact' });
    expect(calls.filter(([name]) => !['from', 'select', 'order', 'range'].includes(name))).toEqual([
      ['eq', 'kind', 'review'],
    ]);
    expect(calls.filter(([name]) => name === 'order')).toEqual([
      ['order', 'submitted_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
    ]);
    expect(calls.find(([name]) => name === 'range')).toEqual(['range', 0, REVIEWS_PAGE_SIZE - 1]);
  });

  test('every filter becomes a condition on the server, all of them at once', async () => {
    const { client, calls } = recordingClient();

    await fetchReviewPage(client, EVERYTHING, 2);

    expect(calls.find(([name]) => name === 'select')?.[1]).toContain(
      'findings:signal_findings!inner(status)',
    );
    expect(calls.filter(([name]) => !['from', 'select', 'order', 'range'].includes(name))).toEqual([
      ['eq', 'kind', 'review'],
      ['in', 'channel', ['airbnb', 'booking']],
      ['in', 'property_id', [7, 40]],
      ['gte', 'rating', 2],
      ['lte', 'rating', 6],
      ['gte', 'departure_date', '2025-11-01'],
      ['lt', 'departure_date', '2026-11-01'],
      ['eq', 'has_public_text', true],
      ['eq', 'has_private_text', true],
      ['eq', 'is_hidden', true],
      ['lte', 'category_ratings->cleanliness', 6],
      ['in', 'findings.status', ['candidate', 'duplicate', 'already_fixed']],
    ]);
    expect(calls.find(([name]) => name === 'range')).toEqual([
      'range',
      2 * REVIEWS_PAGE_SIZE,
      3 * REVIEWS_PAGE_SIZE - 1,
    ]);
  });

  test('«any category» is one `or` over the categories', async () => {
    const { client, calls } = recordingClient();

    await fetchReviewPage(client, { ...EMPTY_REVIEW_FILTERS, lowCategory: 'any' }, 0);

    expect(calls.find(([name]) => name === 'or')).toEqual(['or', anyCategoryLow()]);
  });

  test('a page past the end, after the rows went away under the pager, is an empty page', async () => {
    const { client } = recordingClient({ error: { code: 'PGRST103' }, count: 10 });

    await expect(fetchReviewPage(client, EMPTY_REVIEW_FILTERS, 5)).resolves.toEqual({
      reviews: [],
      total: 10,
    });
  });

  test('any other refusal is the screen’s error', async () => {
    const { client } = recordingClient({ error: { code: '42501' } });

    await expect(fetchReviewPage(client, EMPTY_REVIEW_FILTERS, 0)).rejects.toEqual({
      code: '42501',
    });
  });
});
