import { reportError as reportErrorToSentry } from '@/lib/sentry';

import { fetchKbArticles, fetchKbPlace } from '../api';

jest.mock('@/lib/sentry', () => ({ reportError: jest.fn() }));
const reportError = jest.mocked(reportErrorToSentry);

const mockCalls: { table: string; columns: string; filters: [string, unknown][] }[] = [];
let mockAnswer: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        const call = { table, columns, filters: [] as [string, unknown][] };
        mockCalls.push(call);
        return {
          eq: (column: string, value: unknown) => {
            call.filters.push([column, value]);
            return Promise.resolve(mockAnswer);
          },
        };
      },
    }),
  },
}));

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  scope: 'building',
  language: 'ru',
  title: 'Котёл',
  body: 'В коридоре.',
  updated_at: '2026-10-17T08:00:00Z',
  targets: [{ property_id: 900066010, property: null }],
  translations: [{ language: 'cs', title: 'Kotel', body: 'V chodbě.' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockAnswer = { data: [], error: null };
});

describe('the articles', () => {
  test('only the published ones are asked for: the rules of the base decide the rest', async () => {
    mockAnswer = { data: [ROW], error: null };

    const rows = await fetchKbArticles();

    expect(mockCalls).toEqual([
      expect.objectContaining({ table: 'kb_articles', filters: [['status', 'published']] }),
    ]);
    expect(rows).toEqual([ROW]);
  });

  test('an article this build cannot read is left out and said to Sentry, not lost quietly', async () => {
    mockAnswer = { data: [{ ...ROW, id: 'new-language', language: 'de' }, ROW], error: null };

    const rows = await fetchKbArticles();

    expect(rows).toEqual([ROW]);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0][0])).toMatch(/1 of 2/);
  });

  test('a refusal is thrown as it came, for the screen to say', async () => {
    const refusal = { code: 'PGRST205', message: 'Could not find the table' };
    mockAnswer = { data: null, error: refusal };

    await expect(fetchKbArticles()).rejects.toBe(refusal);
  });
});

describe('the place', () => {
  test('one row by its id', async () => {
    const place = {
      id: 1000000066011,
      name: 'Room one',
      parent_id: 900066010,
      hostaway_unit_id: 66011,
      parent: { name: 'The house' },
    };
    mockAnswer = { data: [place], error: null };

    await expect(fetchKbPlace(place.id)).resolves.toEqual(place);
    expect(mockCalls).toEqual([
      expect.objectContaining({ table: 'properties', filters: [['id', place.id]] }),
    ]);
  });

  test('null for a place the reader cannot see', async () => {
    mockAnswer = { data: [], error: null };

    await expect(fetchKbPlace(42)).resolves.toBeNull();
  });
});
