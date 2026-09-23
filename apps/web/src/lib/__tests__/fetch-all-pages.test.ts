import { describe, expect, test } from 'vitest';

import { fetchAllPages, type Page } from '../fetch-all-pages';

interface Row {
  id: number;
}

function rows(count: number, first = 0): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: first + index }));
}

function ids(list: readonly Row[]): number[] {
  return list.map((row) => row.id);
}

interface Call {
  from: number;
  to: number;
  withCount: boolean;
}

interface ServerOptions {
  /** The server's own max-rows: it cuts every page to this many. */
  cap?: number;
  /** Never answers a count, the way the select guard's recording client does. */
  withoutCount?: boolean;
  /** Changes the rows once the first page has been answered — a webhook landing mid-read. */
  between?: (current: Row[]) => Row[];
}

/**
 * A stand-in for PostgREST: serves `from..to` of the rows it holds, cut at the
 * server cap, and counts them only when asked to.
 */
function fakeServer(initial: Row[], options: ServerOptions = {}) {
  let current = initial;
  const calls: Call[] = [];

  const request = async (from: number, to: number, withCount: boolean): Promise<Page<Row>> => {
    calls.push({ from, to, withCount });
    const size = Math.min(to - from + 1, options.cap ?? Number.POSITIVE_INFINITY);
    const data = current.slice(from, from + size);
    const count = withCount && !options.withoutCount ? current.length : null;
    if (calls.length === 1 && options.between) {
      current = options.between(current);
    }
    return { data, error: null, count };
  };

  return { request, calls };
}

describe('reading a list longer than one page', () => {
  test('returns every row once, in the order the server sorted them', async () => {
    const server = fakeServer(rows(1200));

    const result = await fetchAllPages(server.request);

    expect(ids(result)).toEqual(ids(rows(1200)));
    expect(server.calls).toHaveLength(3);
  });

  test('asks for the count on the first request only', async () => {
    const server = fakeServer(rows(1200));

    await fetchAllPages(server.request);

    expect(server.calls.map((call) => call.withCount)).toEqual([true, false, false]);
  });

  test('an empty list with a count costs one request', async () => {
    const server = fakeServer([]);

    const result = await fetchAllPages(server.request);

    expect(result).toEqual([]);
    expect(server.calls).toHaveLength(1);
  });

  test('a list that fits one page costs one request', async () => {
    const server = fakeServer(rows(40));

    const result = await fetchAllPages(server.request);

    expect(result).toHaveLength(40);
    expect(server.calls).toHaveLength(1);
  });
});

describe('a server that cuts pages shorter than asked', () => {
  test('is followed at its own page size, so no rows are skipped', async () => {
    const server = fakeServer(rows(1000), { cap: 300 });

    const result = await fetchAllPages(server.request);

    expect(ids(result)).toEqual(ids(rows(1000)));
    expect(server.calls.map((call) => call.from)).toEqual([0, 300, 600, 900]);
  });
});

describe('rows that change while the pages are read', () => {
  test('a row leaving the filter cannot make the read loop', async () => {
    // The booking at id 10 is cancelled after the first page: every later row
    // moves up by one, and the row that slid across the page edge waits for
    // the next refetch instead of being chased.
    const server = fakeServer(rows(1000), {
      between: (current) => current.filter((row) => row.id !== 10),
    });

    const result = await fetchAllPages(server.request);

    expect(server.calls).toHaveLength(2);
    expect(new Set(ids(result)).size).toBe(result.length);
    expect(ids(result)).not.toContain(500);
    expect(result).toHaveLength(999);
  });

  test('a row added in front shows up once, not twice', async () => {
    const server = fakeServer(rows(1000), {
      between: (current) => [{ id: -1 }, ...current],
    });

    const result = await fetchAllPages(server.request);

    expect(new Set(ids(result)).size).toBe(result.length);
  });
});

describe('a server that answers no count', () => {
  test('is read page by page until a short page', async () => {
    const server = fakeServer(rows(1200), { withoutCount: true });

    const result = await fetchAllPages(server.request);

    expect(ids(result)).toEqual(ids(rows(1200)));
    expect(server.calls).toHaveLength(3);
  });

  test('an empty answer costs one request', async () => {
    const server = fakeServer([], { withoutCount: true });

    const result = await fetchAllPages(server.request);

    expect(result).toEqual([]);
    expect(server.calls).toHaveLength(1);
  });

  test('a source that never runs dry is stopped by the request limit, loudly', async () => {
    let next = 0;
    const endless = async (from: number, to: number): Promise<Page<Row>> => {
      const page = rows(to - from + 1, next);
      next += page.length;
      return { data: page, error: null, count: null };
    };

    await expect(fetchAllPages(endless)).rejects.toThrow(/request limit/);
  });
});

describe('failures', () => {
  test('a row without an id fails the read instead of being merged by value', async () => {
    const noIds = async (): Promise<Page<string>> => ({ data: ['a', 'a'], error: null, count: 2 });

    await expect(fetchAllPages(noIds)).rejects.toThrow(/carry an id/);
  });

  test('an error on any page fails the whole read, with that error', async () => {
    const failure = { message: 'boom', code: 'PGRST000' };
    let call = 0;
    const flaky = async (from: number, to: number): Promise<Page<Row>> => {
      call += 1;
      if (call === 2) {
        return { data: null, error: failure, count: null };
      }
      return { data: rows(to - from + 1, from), error: null, count: 1200 };
    };

    await expect(fetchAllPages(flaky)).rejects.toBe(failure);
  });
});

describe('the pages after the first', () => {
  test('are read in parallel, never more than four at once', async () => {
    let inFlight = 0;
    let most = 0;
    const all = rows(5000);
    const slow = async (from: number, to: number, withCount: boolean): Promise<Page<Row>> => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { data: all.slice(from, to + 1), error: null, count: withCount ? all.length : null };
    };

    const result = await fetchAllPages(slow);

    expect(result).toHaveLength(5000);
    expect(most).toBe(4);
  });

  test('keep the server order even when they answer out of order', async () => {
    const all = rows(2000);
    const backwards = async (from: number, to: number, withCount: boolean): Promise<Page<Row>> => {
      // Later pages answer sooner.
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, 20 - from / 100)));
      return { data: all.slice(from, to + 1), error: null, count: withCount ? all.length : null };
    };

    const result = await fetchAllPages(backwards);

    expect(ids(result)).toEqual(ids(all));
  });
});
