'use client';

import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { serverErrorText } from '@/lib/server-error';
import { useAddressState } from '@/lib/use-address-state';
import { cn } from '@/lib/utils';

import {
  readApartmentsAddress,
  writeApartmentsAddress,
  type ApartmentsAddress,
  type CardTab,
} from './address';
import { ListingLinksProvider } from './listing-link';
import { PropertyCard } from './property-card';
import { Registry } from './registry';
import { StatusDialog, type StatusSubject } from './status-dialog';
import { useSyncListings } from './use-apartments';

/** Tailwind's `xl`: from here the registry and the card stand side by side. */
const SIDE_BY_SIDE = '(min-width: 80rem)';

/** Whether the two fit side by side now; a browser with no media queries is narrow. */
function isSideBySide(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(SIDE_BY_SIDE).matches;
}

/**
 * «Объекты» (5.4, variant B): the registry and a listing's card side by side.
 *
 * The open listing and its card's tab, the registry's status tab and its
 * search live in the address: a link, a bookmark, a reload or «Назад» find the
 * screen as it was left. Opening a listing, switching its card's tab and
 * switching the status tab are steps «Назад» walks back; the search is changed
 * in place (the owner's rule for «Уборки», 04.10).
 *
 * From `xl` the two stand side by side, the card staying in view while the
 * list scrolls. Below it — a phone, a tablet, a narrow window — there is room
 * for one: an open card takes the list's place, and «Все объекты» brings the
 * list back, so the page never scrolls sideways (decision 14).
 */
export function ApartmentsView() {
  const { t } = useTranslation();
  const sync = useSyncListings();
  const [address, setAddress] = useAddressState(readApartmentsAddress, writeApartmentsAddress);
  const [subject, setSubject] = useState<StatusSubject | null>(null);
  const registryRef = useRef<HTMLDivElement>(null);
  const cardPaneRef = useRef<HTMLDivElement>(null);
  // Below xl the block that held the focus is hidden when the other one shows,
  // and the focus would fall into the body (the review of 04.10). Opening a
  // card from the list hands it to the card's heading; closing one — by
  // «Все объекты» or «Назад» — hands it back to that listing in the list.
  const headingFocus = useRef(false);
  const shownListing = useRef(address.listing);
  const claimHeadingFocus = useCallback(() => {
    const isClaimed = headingFocus.current;
    headingFocus.current = false;
    return isClaimed;
  }, []);

  useEffect(() => {
    const closed = shownListing.current;
    shownListing.current = address.listing;
    if (closed === null || address.listing !== null || isSideBySide()) {
      return;
    }
    const active = document.activeElement;
    const isLost =
      active === null || active === document.body || cardPaneRef.current?.contains(active) === true;
    if (!isLost) {
      return;
    }
    const registry = registryRef.current;
    const target =
      registry?.querySelector<HTMLElement>(`[data-listing-link="${closed}"]`) ??
      registry?.querySelector<HTMLElement>('input[type="search"]');
    target?.focus();
  }, [address.listing]);

  const go = (patch: Partial<ApartmentsAddress>) => setAddress({ ...address, ...patch }, 'push');
  const open = (id: number) => {
    if (id === address.listing) {
      return;
    }
    headingFocus.current =
      !isSideBySide() && registryRef.current?.contains(document.activeElement) === true;
    go({ listing: id });
  };
  // Another listing keeps the tab its card was on: the bookings of three flats
  // read one after another. Closing the card starts the next one on «Info».
  const links = {
    href: (id: number) => `/apartments?${writeApartmentsAddress({ ...address, listing: id })}`,
    open,
  };
  const syncFailure = sync.isError ? serverErrorText(sync.error) : null;
  const isCardOpen = address.listing !== null;

  return (
    <ListingLinksProvider value={links}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title={t('panel.nav.apartments')}
          actions={
            <Button
              type="button"
              className="h-11"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending
                ? t('panel.apartments.sync.running')
                : t('panel.apartments.sync.start')}
            </Button>
          }
        />

        {sync.data === undefined ? null : (
          <div role="status" className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <span>
              {t('panel.apartments.sync.done', {
                added: sync.data.propertiesInserted,
                updated: sync.data.propertiesUpdated,
              })}
            </span>
            {sync.data.skipped.length === 0 ? (
              <span className="text-muted-foreground">{t('panel.apartments.sync.noSkips')}</span>
            ) : (
              // The phrase is the panel's; the reasons are the server's own
              // words, small under it, for the manager to pass on (CLAUDE.md).
              <>
                <span className="text-destructive">
                  {t('panel.apartments.sync.skipped', { total: sync.data.skipped.length })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {sync.data.skipped.map((one) => one.reason).join('; ')}
                </span>
              </>
            )}
          </div>
        )}

        {syncFailure === null ? null : (
          <div role="alert" className="flex flex-col gap-1">
            <p className="text-sm text-destructive">{syncFailure.text}</p>
            {syncFailure.detail === null ? null : (
              <p className="text-xs text-muted-foreground">{syncFailure.detail}</p>
            )}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)] xl:items-start">
          <div
            ref={registryRef}
            data-slot="registry"
            className={cn('flex min-w-0 flex-col gap-3', isCardOpen && 'hidden xl:flex')}
          >
            <Registry
              tab={address.status}
              search={address.query}
              openListing={address.listing}
              onTabChange={(status) => go({ status })}
              onSearchChange={(query) => setAddress({ ...address, query })}
              onAsk={setSubject}
            />
          </div>

          <div
            ref={cardPaneRef}
            data-slot="card-pane"
            className={cn(
              'min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto',
              !isCardOpen && 'hidden xl:block',
            )}
          >
            {address.listing === null ? (
              <EmptyState className="rounded-lg border border-dashed p-6 text-center">
                {t('panel.apartments.pickListing')}
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 self-start xl:hidden"
                  onClick={() => go({ listing: null, card: 'info' })}
                >
                  <ChevronLeft aria-hidden="true" />
                  {t('panel.apartments.back')}
                </Button>
                <PropertyCard
                  key={address.listing}
                  propertyId={address.listing}
                  tab={address.card}
                  onTabChange={(card: CardTab) => go({ card })}
                  claimHeadingFocus={claimHeadingFocus}
                />
              </div>
            )}
          </div>
        </div>

        {subject === null ? null : (
          <StatusDialog subject={subject} onClose={() => setSubject(null)} />
        )}
      </div>
    </ListingLinksProvider>
  );
}
