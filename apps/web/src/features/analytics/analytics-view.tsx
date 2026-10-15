'use client';

import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COMPANY_TIME_ZONE } from '@/features/problems/filters';
import { publicEnv } from '@/lib/env';
import { todayIn } from '@/lib/format-date';
import { useAddressState } from '@/lib/use-address-state';

import { useStaff } from '@/features/tasks/use-tasks';

import { readAnalyticsAddress, resolvePeriod, writeAnalyticsAddress } from './address';
import { AnalyticsCharts } from './analytics-charts';
import { AnalyticsTable } from './analytics-table';
import { FiltersBar } from './filters-bar';
import { personLabel } from './format';
import { KpiTiles } from './kpi-tiles';
import { isLocalStand } from './local-stand';
import { PeriodBar } from './period-bar';
import { previousPeriod } from './period';
import { ANALYTICS_TABLES, type AnalyticsQuery, type AnalyticsTable as TableName, type Summary } from './schema';
import { useAnalyticsListings, useAnalyticsSummary } from './use-analytics';

/** Nothing was counted: no cleaning, checkout, night or task in the period, nor a cancelled one. */
export function isEmptySummary(summary: Summary): boolean {
  return (
    summary.cleanings_done === 0 &&
    summary.cleanings_planned === 0 &&
    summary.checkouts === 0 &&
    summary.occupied_nights === 0 &&
    summary.problems_created === 0 &&
    summary.problems_resolved === 0 &&
    summary.problems_open === 0 &&
    summary.problems_cancelled === 0
  );
}

/**
 * The owner's Analytics page (docs/dashboard-metrics.md, step 1): a period
 * and its comparison, the key figures, and five tables to read or download.
 * The figures are counted by the server, on each listing's own day.
 */
export function AnalyticsView() {
  const { t } = useTranslation();
  const [address, setAddress] = useAddressState(readAnalyticsAddress, writeAnalyticsAddress);
  const isLocal = isLocalStand(publicEnv.supabaseUrl);

  const today = todayIn(COMPANY_TIME_ZONE);
  const period = resolvePeriod(address, today);
  const previous = address.compare ? previousPeriod(period) : null;
  const includeTest = isLocal && address.includeTest;

  const query: AnalyticsQuery = { period, filters: address.filters, includeTest };
  const previousQuery: AnalyticsQuery | null =
    previous === null ? null : { ...query, period: previous };

  const current = useAnalyticsSummary(query);
  const before = useAnalyticsSummary(previousQuery);

  // What the filters offer: the listings (rooms are counted under them; the
  // archived ones too, marked, unless the switch hides them) and the people
  // who clean and repair. A chip names anybody still on the team.
  const allListings = (useAnalyticsListings().data ?? []).map((listing) => ({
    id: String(listing.id),
    isArchived: listing.status === 'archived',
    label:
      listing.status === 'archived'
        ? t('panel.analytics.filters.archivedListing', { name: listing.name })
        : listing.name,
  }));
  const listings = allListings.filter((listing) => !(address.filters.hideArchived && listing.isArchived));
  const team = useStaff().data;
  const staff =
    team === undefined
      ? null
      : team.map((person) => ({
          id: person.id,
          role: person.role,
          label: personLabel(person.full_name, address.names),
        }));
  const people = (staff ?? []).filter((person) => person.role !== 'manager' && person.role !== 'admin');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('panel.nav.analytics')} />

      <PeriodBar
        address={address}
        period={period}
        previous={previous}
        isLocalStand={isLocal}
        onChange={(next) => setAddress(next)}
      />

      <FiltersBar
        filters={address.filters}
        listings={listings}
        listingNames={allListings}
        people={people}
        staff={staff}
        onChange={(filters) => setAddress({ ...address, filters })}
      />

      {current.isError ? (
        <ErrorState message={t('panel.analytics.errors.summary')} error={current.error} />
      ) : null}

      {current.data !== undefined && isEmptySummary(current.data) ? (
        <div className="flex flex-col gap-1 rounded-xl bg-muted/50 p-4">
          <p className="font-medium">{t('panel.analytics.empty.title')}</p>
          <EmptyState>{t('panel.analytics.empty.body')}</EmptyState>
        </div>
      ) : null}

      <KpiTiles current={current.data} previous={previous === null ? null : before.data} />

      <AnalyticsCharts
        address={address}
        query={query}
        period={period}
        summary={current.data}
        onChange={(next) => setAddress(next)}
      />

      <Tabs
        value={address.table}
        onValueChange={(table) => setAddress({ ...address, table: table as TableName })}
      >
        <TabsList
          aria-label={t('panel.analytics.tables.label')}
          className="h-auto w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
        >
          {ANALYTICS_TABLES.map((table) => (
            <TabsTrigger key={table} value={table} className="min-h-11 px-3">
              {t(`panel.analytics.tables.${table}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {ANALYTICS_TABLES.map((table) => (
          <TabsContent key={table} value={table}>
            {table === address.table ? (
              <AnalyticsTable
                key={JSON.stringify(query)}
                table={table}
                query={query}
                period={period}
                names={address.names}
              />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
