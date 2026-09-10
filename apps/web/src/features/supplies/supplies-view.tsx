'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { Input } from '@/components/ui/input';

import { CatalogDialog } from './catalog-dialog';
import { PurchaseSummary } from './purchase-summary';
import {
  EMPTY_DATE_RANGE,
  isInDateRange,
  isInTab,
  SUPPLY_TABS,
  type DateRange,
  type SupplyTab,
} from './schema';
import { SupplyCard } from './supply-card';
import { useSupplyRequests } from './use-supplies';

/** The section's page: tabs by stage, cards below, the catalogue and the purchase summary on top. */
export function SuppliesView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SupplyTab>('new');
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [dates, setDates] = useState<DateRange>(EMPTY_DATE_RANGE);
  const { data, isPending, isError } = useSupplyRequests();

  // The date narrows everything: the tab counts have to agree with the list.
  const requests = (data ?? []).filter((request) => isInDateRange(request, dates));
  const shown = requests.filter((request) => isInTab(request, tab));
  const hasDates = dates.from !== '' || dates.to !== '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('panel.supplies.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setIsCatalogOpen(true)}>
            {t('panel.supplies.catalog.open')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending || isError}
            onClick={() => setIsSummaryOpen(true)}
          >
            {t('panel.supplies.summary.open')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          className="w-40"
          aria-label={t('panel.supplies.filters.dateFrom')}
          value={dates.from}
          onChange={(event) => setDates({ ...dates, from: event.target.value })}
        />
        <Input
          type="date"
          className="w-40"
          aria-label={t('panel.supplies.filters.dateTo')}
          value={dates.to}
          onChange={(event) => setDates({ ...dates, to: event.target.value })}
        />
        {hasDates ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDates(EMPTY_DATE_RANGE)}
          >
            {t('panel.supplies.filters.reset')}
          </Button>
        ) : null}
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('panel.supplies.loading')}</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.supplies.loadError')}
        </p>
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as SupplyTab)}>
          <TabsList>
            {SUPPLY_TABS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`panel.supplies.tabs.${key}`)}
                <span className="ml-1 text-xs text-muted-foreground">
                  {requests.filter((request) => isInTab(request, key)).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab} className="flex flex-col gap-3">
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('panel.supplies.empty')}</p>
            ) : (
              shown.map((request) => <SupplyCard key={request.id} request={request} />)
            )}
          </TabsContent>
        </Tabs>
      )}

      <PurchaseSummary requests={requests} open={isSummaryOpen} onOpenChange={setIsSummaryOpen} />
      <CatalogDialog open={isCatalogOpen} onOpenChange={setIsCatalogOpen} />
    </div>
  );
}
