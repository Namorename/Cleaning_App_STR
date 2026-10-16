import { describe, expect, test, vi } from 'vitest';

import { i18n } from '@/lib/i18n';

import { NO_FILTERS, type AnalyticsFilters } from '../../schema';
import { readReportInput, type PdfRequest } from '../report-input';
import { ANNA, LOOKUPS, SUMMARY } from './fixtures';

interface Call {
  name: string;
  args: Record<string, unknown>;
}

/** A database that answers every analytics function, and writes down what it was asked. */
function recordingClient(summaryFor: (args: Record<string, unknown>) => unknown = () => SUMMARY) {
  const calls: Call[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: name === 'analytics_summary' ? summaryFor(args) : [], error: null };
  });
  return { client: { rpc } as unknown as PdfRequest['client'], calls };
}

function request(client: PdfRequest['client'], filters: AnalyticsFilters, compared: boolean): PdfRequest {
  return {
    client,
    period: { from: '2026-10-01', to: '2026-10-31' },
    previous: compared ? { from: '2026-09-01', to: '2026-09-30' } : null,
    filters,
    names: 'initials',
    language: 'en',
    t: i18n.getFixedT('en'),
    lookups: LOOKUPS,
    fileName: 'woom-analytics-report_2026-10-01_to_2026-10-31.pdf',
  };
}

const NOW = new Date('2026-10-15T18:41:00Z');

describe('readReportInput', () => {
  test('asks the page own functions, every one without the demo listings', async () => {
    const { client, calls } = recordingClient();
    const filters = { ...NO_FILTERS, propertyIds: [1], personIds: [ANNA] };
    const input = await readReportInput(request(client, filters, true), NOW);

    expect(calls.map((call) => call.name).sort()).toEqual([
      'analytics_checkouts_by_property',
      'analytics_cleanings_by_cleaner',
      'analytics_cleanings_by_cleaner',
      'analytics_cleanings_by_property',
      'analytics_cleanings_by_property',
      'analytics_problems_by_property',
      'analytics_problems_by_technician',
      'analytics_series',
      'analytics_summary',
      'analytics_summary',
    ]);
    expect(calls.every((call) => call.args.p_include_test === false)).toBe(true);
    expect(input.names).toBe('initials');
    expect(input.generatedAt).toBe(NOW);
    expect(input.previousSummary).toEqual(SUMMARY);
  });

  test('each bar list drops its own filter; the tables keep every filter', async () => {
    const { client, calls } = recordingClient();
    const filters = { ...NO_FILTERS, propertyIds: [1], personIds: [ANNA] };
    await readReportInput(request(client, filters, true), NOW);

    const byListing = calls.filter((call) => call.name === 'analytics_cleanings_by_property');
    const top = byListing.find((call) => call.args.p_limit === 8);
    const whole = byListing.find((call) => call.args.p_limit === 500);
    expect(top?.args.p_property_ids).toBeUndefined();
    expect(top?.args.p_assignee_ids).toEqual([ANNA]);
    expect(whole?.args.p_property_ids).toEqual([1]);

    const byCleaner = calls.filter((call) => call.name === 'analytics_cleanings_by_cleaner');
    expect(byCleaner.find((call) => call.args.p_limit === 8)?.args.p_assignee_ids).toBeUndefined();
  });

  test('without a comparison one summary is read; urgency filtered, its bars get their own', async () => {
    const urgency = { ...SUMMARY, problems_by_priority: { low: 9, normal: 9, high: 9 } };
    const { client, calls } = recordingClient((args) => (args.p_priorities === undefined ? urgency : SUMMARY));
    const input = await readReportInput(request(client, { ...NO_FILTERS, priorities: ['high'] }, false), NOW);

    expect(calls.filter((call) => call.name === 'analytics_summary')).toHaveLength(2);
    expect(input.previous).toBeNull();
    expect(input.previousSummary).toBeNull();
    expect(input.summary).toEqual(SUMMARY);
    expect(input.bars.urgency).toEqual(urgency);
  });
});
