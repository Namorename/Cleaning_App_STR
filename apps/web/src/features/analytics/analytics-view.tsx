'use client';

import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COMPANY_TIME_ZONE } from '@/features/problems/filters';
import { publicEnv } from '@/lib/env';
import { todayIn } from '@/lib/format-date';
import { useSupabase } from '@/lib/supabase/use-client';
import { useAddressState } from '@/lib/use-address-state';
import { useLanguage } from '@/lib/use-language';

import { useStaff } from '@/features/tasks/use-tasks';

import {
  readAnalyticsAddress,
  resolvePeriod,
  writeAnalyticsAddress,
  type AnalyticsAddress,
} from './address';
import { AnalyticsCharts } from './analytics-charts';
import { AnalyticsTable } from './analytics-table';
import { reportPdfName } from './file-names';
import { FiltersBar } from './filters-bar';
import { personLabel } from './format';
import { KpiTiles } from './kpi-tiles';
import { isLocalStand } from './local-stand';
import { PdfButton, type LookupsFailure } from './pdf-button';
import type { PdfRequest } from './pdf/report-input';
import { PeriodBar } from './period-bar';
import { previousPeriod } from './period';
import { ANALYTICS_TABLES, type AnalyticsQuery, type AnalyticsTable as TableName } from './schema';
import { isEmptySummary } from './summary';
import { useAnalyticsListings, useAnalyticsSummary } from './use-analytics';
import { wholeListsAsAll, type FilterChoices } from './whole-lists';

/** The people the filters offer: those who clean and repair, not the office. */
function isFieldRole(role: string): boolean {
  return role !== 'manager' && role !== 'admin';
}

/**
 * The owner's Analytics page (docs/dashboard-metrics.md, step 1): a period
 * and its comparison, the key figures, and five tables to read or download.
 * The figures are counted by the server, on each listing's own day.
 */
export function AnalyticsView() {
  const { t } = useTranslation();

  // What the filters offer: the listings (rooms are counted under them; the
  // archived ones too, marked, unless the switch hides them) and the people
  // who clean and repair. A chip names anybody still on the team.
  const listingsQuery = useAnalyticsListings();
  const listingsRead = listingsQuery.data;
  const teamQuery = useStaff();
  const team = teamQuery.data;
  const choices: FilterChoices = {
    listings: (listingsRead ?? []).map((listing) => ({
      id: listing.id,
      isArchived: listing.status === 'archived',
    })),
    personIds: (team ?? []).filter((person) => isFieldRole(person.role)).map((person) => person.id),
  };

  // A listing or person list ticked whole is "all" to everything but the
  // ticks themselves: the address, the server, the charts, the report.
  const [address, setAddress] = useAddressState(readAnalyticsAddress, (value: AnalyticsAddress) =>
    writeAnalyticsAddress({ ...value, filters: wholeListsAsAll(value.filters, choices) }),
  );
  const filters = wholeListsAsAll(address.filters, choices);
  const isLocal = isLocalStand(publicEnv.supabaseUrl);

  const today = todayIn(COMPANY_TIME_ZONE);
  const period = resolvePeriod(address, today);
  const previous = address.compare ? previousPeriod(period) : null;
  const includeTest = isLocal && address.includeTest;

  const query: AnalyticsQuery = { period, filters, includeTest };
  const previousQuery: AnalyticsQuery | null =
    previous === null ? null : { ...query, period: previous };

  const current = useAnalyticsSummary(query);
  const before = useAnalyticsSummary(previousQuery);

  // The files are named by a listing's own name, not the chip's words (file-names.ts).
  const listingName = (id: number) => listingsRead?.find((listing) => listing.id === id)?.name;
  const allListings = (listingsRead ?? []).map((listing) => ({
    id: String(listing.id),
    isArchived: listing.status === 'archived',
    label:
      listing.status === 'archived'
        ? t('panel.analytics.filters.archivedListing', { name: listing.name })
        : listing.name,
  }));
  const listings = allListings.filter((listing) => !(address.filters.hideArchived && listing.isArchived));
  const staff =
    team === undefined
      ? null
      : team.map((person) => ({
          id: person.id,
          role: person.role,
          label: personLabel(person.full_name, address.names),
        }));
  const people = (staff ?? []).filter((person) => isFieldRole(person.role));
  const lookups = { listingNames: allListings, people, staff };

  // The report names its listings and people: a list that never came is said
  // under the button, with a press to load it again — not a silent grey button.
  // While it is asked again TanStack clears the error (pending, fetching — or
  // paused, with no network), so a failure behind it keeps the reason and the
  // busy press on the screen.
  const isAsking = (read: { isFetching: boolean; isPaused: boolean }) => read.isFetching || read.isPaused;
  const unloaded = [listingsQuery, teamQuery].filter(
    (read) => read.data === undefined && (read.isError || (isAsking(read) && read.errorUpdateCount > 0)),
  );
  const lookupsFailed: LookupsFailure | null =
    unloaded.length === 0
      ? null
      : {
          error: unloaded.find((read) => read.error !== null)?.error ?? null,
          retry: () => unloaded.forEach((read) => void read.refetch()),
          isRetrying: unloaded.some(isAsking),
        };

  const client = useSupabase();
  const language = useLanguage();
  // The report of the page as it is: its period, comparison, filters and names.
  const pdfRequest = (): PdfRequest => ({
    client,
    period,
    previous,
    filters,
    names: address.names,
    language,
    t: (key, values) => t(key, values),
    lookups,
    fileName: reportPdfName({ period, filters, listingName }),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('panel.nav.analytics')}
        actions={
          // The report names its filters: it waits for the figures, the team and the listings.
          <PdfButton
            request={pdfRequest}
            disabled={current.data === undefined || staff === null || listingsRead === undefined}
            lookupsFailed={lookupsFailed}
          />
        }
      />

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
        // A bar picked from a whole list narrows to that bar alone.
        address={{ ...address, filters }}
        query={query}
        period={period}
        summary={current.data}
        lookups={lookups}
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
                listingName={listingName}
              />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
