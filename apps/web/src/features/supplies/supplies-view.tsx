'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { PurchaseSummary } from './purchase-summary';
import { isInTab, SUPPLY_TABS, type SupplyTab } from './schema';
import { SupplyCard } from './supply-card';
import { useSupplyRequests } from './use-supplies';

/** The section's page: tabs by stage, cards below, the purchase summary on top. */
export function SuppliesView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SupplyTab>('new');
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const { data, isPending, isError } = useSupplyRequests();

  const requests = data ?? [];
  const shown = requests.filter((request) => isInTab(request, tab));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('panel.supplies.title')}</h1>
        <Button
          type="button"
          variant="outline"
          disabled={isPending || isError}
          onClick={() => setIsSummaryOpen(true)}
        >
          {t('panel.supplies.summary.open')}
        </Button>
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
    </div>
  );
}
