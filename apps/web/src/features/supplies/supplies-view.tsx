'use client';

import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useAddressState } from '@/lib/use-address-state';
import { useListPaneFocus } from '@/lib/use-list-pane-focus';
import { cn } from '@/lib/utils';

import { readSuppliesAddress, writeSuppliesAddress, type SuppliesAddress } from './address';
import { CatalogDialog } from './catalog-dialog';
import { PurchaseSummary } from './purchase-summary';
import { RequestDetail } from './request-detail';
import { RequestFilters } from './request-filters';
import { RequestList } from './request-list';
import {
  EMPTY_DATE_RANGE,
  isInDateRange,
  matchesRequestSearch,
  type SupplyRequest,
} from './schema';
import { useSupplyRequests } from './use-supplies';

/**
 * «Заявки на расходники» (5.4, variant B): the list of requests and the open
 * one side by side — its lines, note, moves and files — instead of a big card
 * per request, two to a screen.
 *
 * The tab, the search, the dates and the open request live in the address: a
 * link, a bookmark, a reload or «Назад» find the screen as it was left.
 * Opening a request and switching the tab are steps «Назад» walks back; the
 * search and the dates are changed in place (the owner's rule for «Уборки»,
 * 04.10).
 *
 * From `xl` the two stand side by side, the request staying in view while the
 * list scrolls. Below it there is room for one: an open request takes the
 * list's place, and «Все заявки» brings the list back, so the page never
 * scrolls sideways (decision 14). The catalogue and the purchase summary stay
 * dialogs opened from the page's header.
 */
export function SuppliesView() {
  const { t } = useTranslation();
  const [address, setAddress] = useAddressState(readSuppliesAddress, writeSuppliesAddress);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const { data, isPending, isError, error } = useSupplyRequests();
  const { listRef, paneRef, noteOpening, claimHeadingFocus } = useListPaneFocus(
    address.request,
    'data-request-link',
  );

  // The dates narrow everything, the purchase summary included. The search
  // finds a request to read: it narrows the list and its counters, never the
  // purchase — a summary made while «karlin» is typed is still the period's.
  const all = data ?? [];
  const dated = all.filter((request) => isInDateRange(request, address.dates));
  const found = dated.filter((request) => matchesRequestSearch(request, address.query));
  const isOpen = address.request !== null;

  const step = (patch: Partial<SuppliesAddress>) => setAddress({ ...address, ...patch }, 'push');
  const narrow = (patch: Partial<SuppliesAddress>) => setAddress({ ...address, ...patch });
  const open = (id: string) => {
    if (id === address.request) {
      return;
    }
    noteOpening();
    step({ request: id });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('panel.supplies.title')}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setIsCatalogOpen(true)}
            >
              {t('panel.supplies.catalog.open')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={data === undefined}
              onClick={() => setIsSummaryOpen(true)}
            >
              {t('panel.supplies.summary.open')}
            </Button>
          </>
        }
      />

      {isPending ? (
        <LoadingState>{t('panel.supplies.loading')}</LoadingState>
      ) : isError && data === undefined ? (
        <ErrorState message={t('panel.supplies.loadError')} error={error} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)] xl:items-start">
          <div
            ref={listRef}
            data-slot="request-list"
            className={cn('flex min-w-0 flex-col gap-3', isOpen && 'hidden xl:flex')}
          >
            <RequestFilters
              query={address.query}
              dates={address.dates}
              onQueryChange={(query) => narrow({ query })}
              onDatesChange={(dates) => narrow({ dates })}
              onReset={() => narrow({ query: '', dates: EMPTY_DATE_RANGE })}
            />
            <RequestList
              requests={found}
              tab={address.tab}
              openRequest={address.request}
              onTabChange={(tab) => step({ tab })}
              hrefOf={(id) => `/supplies?${writeSuppliesAddress({ ...address, request: id })}`}
              onOpen={open}
            />
          </div>

          <div
            ref={paneRef}
            data-slot="request-pane"
            className={cn(
              'min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto',
              !isOpen && 'hidden xl:block',
            )}
          >
            <RequestPane
              requests={all}
              openId={address.request}
              onClose={() => step({ request: null })}
              claimHeadingFocus={claimHeadingFocus}
            />
          </div>
        </div>
      )}

      <PurchaseSummary requests={dated} open={isSummaryOpen} onOpenChange={setIsSummaryOpen} />
      <CatalogDialog open={isCatalogOpen} onOpenChange={setIsCatalogOpen} />
    </div>
  );
}

interface RequestPaneProps {
  /** Every request loaded: one the tab or the search leaves out still opens. */
  requests: readonly SupplyRequest[];
  openId: string | null;
  onClose: () => void;
  claimHeadingFocus: () => boolean;
}

/** Beside the list: the open request, or how to open one. */
function RequestPane({ requests, openId, onClose, claimHeadingFocus }: RequestPaneProps) {
  const { t } = useTranslation();

  if (openId === null) {
    return (
      <EmptyState className="rounded-lg border border-dashed p-6 text-center">
        {t('panel.supplies.pickRequest')}
      </EmptyState>
    );
  }
  const request = requests.find((one) => one.id === openId);

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="ghost" className="h-11 self-start xl:hidden" onClick={onClose}>
        <ChevronLeft aria-hidden="true" />
        {t('panel.supplies.back')}
      </Button>
      {request === undefined ? (
        <EmptyState>{t('supplies.notFound')}</EmptyState>
      ) : (
        <RequestDetail key={request.id} request={request} claimHeadingFocus={claimHeadingFocus} />
      )}
    </div>
  );
}
