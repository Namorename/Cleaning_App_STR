import { describe, expect, test } from 'vitest';

import {
  fetchReportCatalog,
  fetchReportCategories,
  fetchReportMode,
  reportCatalogOf,
  type ReportCatalogData,
} from '../catalog';

/**
 * «Новое задание» picks a category only where the company reports by catalogue
 * (hosts.problem_report_mode = catalog), and never waits on the catalogue: a company that types,
 * a read that fails and an empty list all give the form of before.
 */

interface Answer {
  data: unknown;
  error: unknown;
}

/** A client that answers each table with what the test says, and records what was asked. */
function fakeClient(answers: Record<string, Answer>) {
  const asked: { table: string; calls: [string, ...unknown[]][] }[] = [];
  const client = {
    from: (table: string) => {
      const entry = { table, calls: [] as [string, ...unknown[]][] };
      asked.push(entry);
      const answer = Promise.resolve(answers[table] ?? { data: null, error: { message: 'no' } });
      const chain: Record<string, unknown> = new Proxy(
        { then: answer.then.bind(answer) },
        {
          get(target, property: string) {
            if (property in target) {
              return target[property as keyof typeof target];
            }
            return (...args: unknown[]) => {
              entry.calls.push([property, ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
  return { client: client as never, asked };
}

const FLOOD = {
  id: 'd2e00844-d88c-4324-ab60-dbed5bb56a59',
  name: 'Затопление',
  name_i18n: { en: 'Flooding' },
  synonyms: ['потоп'],
  priority: 'high',
  critical: true,
};

describe('the company’s way of naming a task', () => {
  test('catalog is read as catalog', async () => {
    const { client, asked } = fakeClient({
      hosts: { data: { problem_report_mode: 'catalog' }, error: null },
    });
    await expect(fetchReportMode(client)).resolves.toBe('catalog');
    expect(asked[0].calls[0]).toEqual(['select', 'problem_report_mode']);
  });

  test('free_text, a value of a newer server and no row are all typed', async () => {
    for (const data of [{ problem_report_mode: 'free_text' }, { problem_report_mode: 'voice' }, null]) {
      const { client } = fakeClient({ hosts: { data, error: null } });
      await expect(fetchReportMode(client)).resolves.toBe('free_text');
    }
  });

  test('a refusal is thrown, for the form to fall back on', async () => {
    const { client } = fakeClient({ hosts: { data: null, error: { message: 'boom' } } });
    await expect(fetchReportMode(client)).rejects.toEqual({ message: 'boom' });
  });

  test('a request that hangs is given up after a while', async () => {
    const { client, asked } = fakeClient({ hosts: { data: null, error: null } });
    await fetchReportMode(client);
    const [, signal] = asked[0].calls.find(([name]) => name === 'abortSignal') ?? [];
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('the catalogue', () => {
  test('the live categories, in the company’s own order', async () => {
    const { client, asked } = fakeClient({ problem_categories: { data: [FLOOD], error: null } });
    const categories = await fetchReportCategories(client);

    expect(categories).toEqual([FLOOD]);
    expect(asked[0].calls).toEqual(
      expect.arrayContaining([
        ['select', 'id, name, name_i18n, synonyms, priority, critical'],
        ['is', 'archived_at', null],
        ['order', 'sort_order', { ascending: true }],
        ['order', 'name', { ascending: true }],
      ]),
    );
  });

  test('a field a newer server spells differently does not empty the list', async () => {
    const odd = { ...FLOOD, name_i18n: null, synonyms: 'x', priority: 'urgent', critical: 'yes' };
    const { client } = fakeClient({ problem_categories: { data: [odd], error: null } });
    const [category] = await fetchReportCategories(client);

    expect(category).toMatchObject({ name_i18n: {}, synonyms: [], priority: null, critical: false });
  });

  test('a typed company never reads the catalogue', async () => {
    const { client, asked } = fakeClient({
      hosts: { data: { problem_report_mode: 'free_text' }, error: null },
      problem_categories: { data: [FLOOD], error: null },
    });
    await expect(fetchReportCatalog(client)).resolves.toEqual({ mode: 'free_text', categories: [] });
    expect(asked.map((entry) => entry.table)).toEqual(['hosts']);
  });

  test('the two reads share one deadline', async () => {
    const { client, asked } = fakeClient({
      hosts: { data: { problem_report_mode: 'catalog' }, error: null },
      problem_categories: { data: [FLOOD], error: null },
    });
    const deadline = new AbortController();
    await fetchReportCatalog(client, deadline.signal);

    const signals = asked.map(
      (entry) => entry.calls.find(([name]) => name === 'abortSignal')?.[1],
    );
    expect(signals).toEqual([deadline.signal, deadline.signal]);
  });

  test('a read that hangs past the deadline fails, for the form to take a typed title', async () => {
    const deadline = new AbortController();
    // A client that answers only when its request is aborted, as supabase-js does.
    const hanging = {
      from: () => {
        let signal: AbortSignal | undefined;
        const chain: Record<string, unknown> = new Proxy(
          {
            then: (resolve: (answer: Answer) => void) => {
              const aborted = () => resolve({ data: null, error: { message: 'AbortError: aborted' } });
              if (signal?.aborted) {
                aborted();
              } else {
                signal?.addEventListener('abort', aborted);
              }
            },
          },
          {
            get(target, property: string) {
              if (property in target) {
                return target[property as keyof typeof target];
              }
              return (...args: unknown[]) => {
                if (property === 'abortSignal') {
                  signal = args[0] as AbortSignal;
                }
                return chain;
              };
            },
          },
        );
        return chain;
      },
    };

    const answer = fetchReportCatalog(hanging as never, deadline.signal);
    // The request is out and nothing answers; then the deadline passes.
    await new Promise((resolve) => setTimeout(resolve, 20));
    deadline.abort();
    await expect(answer).rejects.toEqual({ message: 'AbortError: aborted' });
  });

  test('a company that picks reads both', async () => {
    const { client } = fakeClient({
      hosts: { data: { problem_report_mode: 'catalog' }, error: null },
      problem_categories: { data: [FLOOD], error: null },
    });
    await expect(fetchReportCatalog(client)).resolves.toEqual({
      mode: 'catalog',
      categories: [FLOOD],
    });
  });
});

describe('what the form asks for', () => {
  const catalog: ReportCatalogData = {
    mode: 'catalog',
    categories: [FLOOD] as ReportCatalogData['categories'],
  };

  test('a category, where the company picks and the list is there', () => {
    expect(reportCatalogOf({ data: catalog, isError: false })).toEqual({
      kind: 'catalog',
      categories: catalog.categories,
    });
  });

  test('a typed title for a company that types', () => {
    expect(reportCatalogOf({ data: { mode: 'free_text', categories: [] }, isError: false })).toEqual({
      kind: 'free',
    });
  });

  test('a typed title when the catalogue failed to load or is empty', () => {
    expect(reportCatalogOf({ data: undefined, isError: true })).toEqual({ kind: 'free' });
    expect(reportCatalogOf({ data: { mode: 'catalog', categories: [] }, isError: false })).toEqual({
      kind: 'free',
    });
  });

  test('nothing yet while the first answer is on its way', () => {
    expect(reportCatalogOf({ data: undefined, isError: false })).toEqual({ kind: 'pending' });
  });

  test('a later read that fails keeps the list read before', () => {
    expect(reportCatalogOf({ data: catalog, isError: true }).kind).toBe('catalog');
  });
});
