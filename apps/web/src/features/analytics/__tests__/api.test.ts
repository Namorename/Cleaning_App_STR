import { describe, expect, it, vi } from 'vitest';

import { fetchSummary, fetchTablePage, fetchWholeTable, rpcArgs, WHOLE_TABLE_PAGE } from '../api';
import { NO_FILTERS, type AnalyticsQuery } from '../schema';

const query: AnalyticsQuery = {
  period: { from: '2026-10-01', to: '2026-10-31' },
  filters: NO_FILTERS,
  includeTest: false,
};

const SUMMARY = {
  cleanings_done: 5,
  cleanings_done_midstay: 1,
  cleanings_planned: 6,
  cleanings_planned_midstay: 1,
  cleaning_minutes_median: 75,
  cleaning_minutes_avg: 75,
  cleanings_with_photo: 1,
  photo_share: 0.2,
  checkouts: 3,
  rooms_released: 2,
  occupied_nights: 6,
  available_nights: 40,
  occupancy: 0.15,
  problems_created: 3,
  problems_resolved: 2,
  problems_open: 2,
  urgency_avg: 2,
};

function listingRow(id: number, total: number) {
  return {
    listing_id: id,
    listing_name: `Flat ${id}`,
    planned: 1,
    done: 1,
    done_midstay: 0,
    expired: 0,
    cancelled: 0,
    minutes_median: null,
    minutes_avg: null,
    photo_share: null,
    total_count: total,
  };
}

function clientAnswering(answer: (name: string, args: Record<string, unknown>) => unknown) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: answer(name, args),
    error: null,
  }));
  return { client: { rpc } as never, rpc };
}

describe('rpcArgs', () => {
  it('sends the period and leaves every "all" filter to the server default', () => {
    expect(rpcArgs(query)).toEqual({
      p_from: '2026-10-01',
      p_to: '2026-10-31',
      p_include_test: false,
    });
  });

  it('sends each filter that names something', () => {
    expect(
      rpcArgs({
        ...query,
        includeTest: true,
        filters: {
          propertyIds: [7],
          personIds: ['a'],
          taskStatuses: ['done'],
          problemStatuses: ['open'],
          priorities: ['high'],
        },
      }),
    ).toEqual({
      p_from: '2026-10-01',
      p_to: '2026-10-31',
      p_include_test: true,
      p_property_ids: [7],
      p_assignee_ids: ['a'],
      p_task_statuses: ['done'],
      p_problem_statuses: ['open'],
      p_priorities: ['high'],
    });
  });
});

describe('fetchSummary', () => {
  it('asks analytics_summary and reads the answer through its schema', async () => {
    const { client, rpc } = clientAnswering(() => SUMMARY);
    await expect(fetchSummary(client, query)).resolves.toEqual(SUMMARY);
    expect(rpc).toHaveBeenCalledWith('analytics_summary', rpcArgs(query));
  });

  it('fails on a figure it cannot read rather than show a zero', async () => {
    const { client } = clientAnswering(() => ({ ...SUMMARY, checkouts: 'many' }));
    await expect(fetchSummary(client, query)).rejects.toThrow();
  });

  it('passes the server refusal on as it came', async () => {
    const refusal = { message: 'Analytics is for managers only', hint: 'serverErrors.managerOnly' };
    const client = { rpc: async () => ({ data: null, error: refusal }) } as never;
    await expect(fetchSummary(client, query)).rejects.toBe(refusal);
  });
});

describe('fetchTablePage', () => {
  it('asks the table function for one page and reads its total', async () => {
    const { client, rpc } = clientAnswering(() => [listingRow(1, 3), listingRow(2, 3)]);
    const page = await fetchTablePage(client, 'cleaningsByProperty', query, {
      limit: 2,
      offset: 0,
    });
    expect(rpc).toHaveBeenCalledWith('analytics_cleanings_by_property', {
      ...rpcArgs(query),
      p_limit: 2,
      p_offset: 0,
    });
    expect(page.total).toBe(3);
    expect(page.rows.map((row) => row.listing_id)).toEqual([1, 2]);
  });

  it('has a total of nothing for an empty page', async () => {
    const { client } = clientAnswering(() => []);
    await expect(
      fetchTablePage(client, 'problemsByTechnician', query, { limit: 25, offset: 0 }),
    ).resolves.toEqual({ rows: [], total: 0 });
  });
});

describe('fetchWholeTable', () => {
  it('reads a table page after page until it has the whole of it', async () => {
    const total = WHOLE_TABLE_PAGE + 2;
    const { client, rpc } = clientAnswering((_name, args) => {
      const offset = args.p_offset as number;
      const size = Math.min(WHOLE_TABLE_PAGE, total - offset);
      return Array.from({ length: size }, (_, at) => listingRow(offset + at, total));
    });
    const rows = await fetchWholeTable(client, 'cleaningsByProperty', query);
    expect(rows).toHaveLength(total);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
