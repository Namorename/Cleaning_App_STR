'use client';

import { Constants } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/states';
import { addDays } from '@/features/calendar/dates';
import { formatDay, formatShortDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import type { AnalyticsAddress } from './address';
import { BarList, type BarItem } from './charts/bar-list';
import { ColumnChart, type ColumnPoint, type ColumnSeries } from './charts/column-chart';
import { formatNumber, personLabel } from './format';
import { periodDays, type Period } from './period';
import type { AnalyticsFilters, AnalyticsQuery, SeriesBucket, SeriesPoint, Summary } from './schema';
import { useAnalyticsSeries, useAnalyticsSummary, useAnalyticsTable } from './use-analytics';

/** Longer than this, the columns are weeks: a day apiece would be too thin to click. */
const DAYS_BY_DAY = 60;
/** The bars of a "by listing" or "by cleaner" chart: the busiest, the table has the rest. */
const TOP_BARS = 8;

const KEY = 'panel.analytics.charts.';

const CLEANINGS: readonly ColumnSeries[] = [
  { name: 'done', fillClass: 'fill-[var(--chart-1)]', swatchClass: 'bg-[var(--chart-1)]' },
  { name: 'checkouts', fillClass: 'fill-[var(--chart-2)]', swatchClass: 'bg-[var(--chart-2)]' },
];
const TASKS: readonly ColumnSeries[] = [
  { name: 'created', fillClass: 'fill-[var(--chart-3)]', swatchClass: 'bg-[var(--chart-3)]' },
  { name: 'resolved', fillClass: 'fill-[var(--chart-4)]', swatchClass: 'bg-[var(--chart-4)]' },
];

/** The value toggled in or out of a list: a click on a bar sets or lifts its filter. */
function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((one) => one !== value) : [...values, value];
}

interface AnalyticsChartsProps {
  address: AnalyticsAddress;
  query: AnalyticsQuery;
  period: Period;
  summary: Summary | undefined;
  onChange: (next: AnalyticsAddress) => void;
}

/**
 * The charts of the page (step 2): the period by day or week, and the bars a
 * click turns into a filter of the whole page — the cross-filter.
 */
export function AnalyticsCharts({ address, query, period, summary, onChange }: AnalyticsChartsProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const bucket: SeriesBucket = periodDays(period) > DAYS_BY_DAY ? 'week' : 'day';
  const series = useAnalyticsSeries(query, bucket);
  const top = { limit: TOP_BARS, offset: 0 };
  // A bar list is not filtered by its own bars: the others stay to be added.
  const without = (part: Partial<AnalyticsFilters>): AnalyticsQuery => ({
    ...query,
    filters: { ...query.filters, ...part },
  });
  const byListing = useAnalyticsTable('cleaningsByProperty', without({ propertyIds: [] }), top);
  const byCleaner = useAnalyticsTable('cleaningsByCleaner', without({ personIds: [] }), top);
  const byUrgency = useAnalyticsSummary(without({ priorities: [] }));

  const setFilters = (filters: AnalyticsFilters) => onChange({ ...address, filters });

  // A column picked: the page narrows to that day, or to the week inside the
  // period. Columns of the period before, still on screen while the new ones
  // load, are not followed.
  const narrow = (key: string) => {
    if (series.isPlaceholderData) {
      return;
    }
    const start = key < period.from ? period.from : key;
    const end = bucket === 'week' ? addDays(key, 6) : key;
    const custom = { from: start > period.to ? period.to : start, to: end > period.to ? period.to : end };
    onChange({ ...address, preset: null, custom });
  };
  const status = (read: { isError: boolean; error: unknown; data: unknown }) =>
    read.isError
      ? { error: <ErrorState message={t('panel.analytics.errors.table')} error={read.error} /> }
      : read.data === undefined
        ? { loading: t('panel.analytics.charts.loading') }
        : undefined;

  const points = (
    pick: (point: SeriesPoint) => number[],
    names: readonly ColumnSeries[],
  ): ColumnPoint[] =>
    (series.data ?? []).map((point) => {
      const values = pick(point);
      const words = names
        .map((one, at) => `${t(`${KEY}${one.name}`)}: ${formatNumber(values[at], language)}`)
        .join(', ');
      return {
        key: point.bucket,
        label: formatShortDay(point.bucket, language),
        values,
        description: t(`${KEY}${bucket}`, { day: formatDay(point.bucket, language), values: words }),
      };
    });
  const named = (names: readonly ColumnSeries[]) =>
    names.map((one) => ({ ...one, name: t(`${KEY}${one.name}`) }));

  const listingBars: BarItem[] = (byListing.data?.rows ?? [])
    .filter((row) => row.done > 0)
    .map((row) => ({
      id: String(row.listing_id),
      label: row.listing_name,
      value: row.done,
      valueText: formatNumber(row.done, language),
    }));
  const cleanerBars: BarItem[] = (byCleaner.data?.rows ?? [])
    .filter((row) => row.done > 0)
    .map((row) => ({
      id: row.person_id,
      label: personLabel(row.full_name, address.names),
      value: row.done,
      valueText: formatNumber(row.done, language),
    }));
  const urgency: Summary | undefined = address.filters.priorities.length === 0 ? summary : byUrgency.data;
  const urgencyBars: BarItem[] =
    urgency === undefined
      ? []
      : Constants.public.Enums.problem_priority.map((priority) => ({
          id: priority,
          label: t(`problems.priorities.${priority}`),
          value: urgency.problems_by_priority[priority],
          valueText: formatNumber(urgency.problems_by_priority[priority], language),
        }));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t(`${KEY}hint`)}</p>
      {series.isError ? (
        <ErrorState message={t('panel.analytics.errors.summary')} error={series.error} />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2" aria-busy={series.isPlaceholderData}>
          <ColumnChart
            title={`${t(`${KEY}dynamics`)} · ${t(`${KEY}${bucket === 'week' ? 'byWeek' : 'byDay'}`)}`}
            series={named(CLEANINGS)}
            points={points((point) => [point.cleanings_done, point.checkouts], CLEANINGS)}
            onSelect={narrow}
          />
          <ColumnChart
            title={`${t(`${KEY}problems`)} · ${t(`${KEY}${bucket === 'week' ? 'byWeek' : 'byDay'}`)}`}
            series={named(TASKS)}
            points={points((point) => [point.problems_created, point.problems_resolved], TASKS)}
            onSelect={narrow}
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <BarList
          title={t(`${KEY}byListing`)}
          status={status(byListing)}
          items={listingBars}
          selected={address.filters.propertyIds.map(String)}
          onToggle={(id) =>
            setFilters({ ...address.filters, propertyIds: toggled(address.filters.propertyIds, Number(id)) })
          }
          emptyText={t(`${KEY}empty`)}
        />
        <BarList
          title={t(`${KEY}byCleaner`)}
          status={status(byCleaner)}
          items={cleanerBars}
          selected={address.filters.personIds}
          onToggle={(id) =>
            setFilters({ ...address.filters, personIds: toggled(address.filters.personIds, id) })
          }
          emptyText={t(`${KEY}empty`)}
        />
        <BarList
          title={t(`${KEY}byUrgency`)}
          items={urgencyBars}
          selected={address.filters.priorities}
          onToggle={(id) =>
            setFilters({
              ...address.filters,
              priorities: toggled(
                address.filters.priorities,
                id as AnalyticsFilters['priorities'][number],
              ),
            })
          }
          emptyText={t(`${KEY}empty`)}
        />
      </div>
    </div>
  );
}
