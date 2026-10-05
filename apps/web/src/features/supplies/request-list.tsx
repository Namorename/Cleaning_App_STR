'use client';

import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { RequestRow } from './request-row';
import { isInTab, SUPPLY_TABS, type SupplyRequest, type SupplyTab } from './schema';

interface RequestListProps {
  /** The requests the search and the dates leave: the counters count these. */
  requests: readonly SupplyRequest[];
  tab: SupplyTab;
  /** The request open beside the list. */
  openRequest: string | null;
  onTabChange: (tab: SupplyTab) => void;
  /** The address that opens a request: a real link, for a new tab too. */
  hrefOf: (id: string) => string;
  onOpen: (id: string) => void;
}

/**
 * The tabs by stage, each with its count, and the requests of the open one,
 * newest first as the server sends them (5.4, variant B: «Новые сверху»).
 */
export function RequestList({
  requests,
  tab,
  openRequest,
  onTabChange,
  hrefOf,
  onOpen,
}: RequestListProps) {
  const { t } = useTranslation();
  const shown = requests.filter((request) => isInTab(request, tab));

  return (
    <>
      <Tabs value={tab} onValueChange={(next) => onTabChange(next as SupplyTab)}>
        <TabsList className="h-auto">
          {SUPPLY_TABS.map((key) => (
            <TabsTrigger key={key} value={key} className="min-h-11 px-3">
              {t(`panel.supplies.tabs.${key}`)}
              <span className="text-xs text-muted-foreground tabular-nums">
                {requests.filter((request) => isInTab(request, key)).length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {shown.length === 0 ? (
        <EmptyState>{t('panel.supplies.empty')}</EmptyState>
      ) : (
        <ul
          aria-label={t(`panel.supplies.tabs.${tab}`)}
          className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
        >
          {shown.map((request) => (
            <li key={request.id}>
              <RequestRow
                request={request}
                href={hrefOf(request.id)}
                isCurrent={request.id === openRequest}
                onOpen={() => onOpen(request.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
