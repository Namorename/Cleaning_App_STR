'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { CARD_TABS, type CardTab } from './address';
import { BookingsTab } from './bookings-tab';
import { ChecklistTab } from './checklist-tab';
import { CleanersTab } from './cleaners-tab';
import { InfoTab } from './info-tab';
import { MaintenanceTab } from './maintenance-tab';
import { isRoom, parentOf, type ListingRef } from './schema';
import { useProperty, useRegistry } from './use-apartments';

interface PropertyCardProps {
  propertyId: number;
  /** The open section; the registry keeps it in the address. Absent, the card keeps its own. */
  tab?: CardTab;
  onTabChange?: (tab: CardTab) => void;
}

/**
 * One flat, everything the company knows about it — beside the registry
 * (5.4, variant B), so its heading is the page's second level: the page's
 * one h1 is «Объекты».
 *
 * Reached from the registry, including from the archive tab — a manager about
 * to bring a listing back should be able to look at it first, so an archived
 * flat opens here like any other and says so at the top.
 */
export function PropertyCard({ propertyId, tab, onTabChange }: PropertyCardProps) {
  const { t } = useTranslation();
  const property = useProperty(propertyId);
  const registry = useRegistry();
  const [ownTab, setOwnTab] = useState<CardTab>('info');
  const current = tab ?? ownTab;
  const setTab = onTabChange ?? setOwnTab;

  const all = registry.data ?? [];

  if (property.isPending) {
    return <LoadingState>{t('panel.apartments.loading')}</LoadingState>;
  }
  // Only when there is nothing to show: a refresh that fails over data already
  // on screen must not take the Info form, and what the manager typed, away.
  if (property.isError && property.data === undefined) {
    return <ErrorState message={t('panel.apartments.loadError')} error={property.error} />;
  }
  if (property.data === null || property.data === undefined) {
    return <EmptyState>{t('panel.apartments.notFound')}</EmptyState>;
  }

  const one = property.data;
  const parent = parentOf(all, one);
  // A room's cleaners, bookings and checklist live on its listing (7.1, trap 5).
  const listing: ListingRef | null =
    isRoom(one) && one.parent_id !== null
      ? { id: one.parent_id, name: parent?.name ?? String(one.parent_id) }
      : null;

  return (
    <section aria-labelledby="property-card-title" className="flex flex-col gap-4">
      <header data-slot="property-head" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="property-card-title" className="text-xl font-semibold break-words">
            {one.name}
          </h2>
          {one.status === 'active' ? null : (
            <StatusBadge status={`property.${one.status}`}>
              {t(`panel.apartments.tabs.${one.status}`)}
            </StatusBadge>
          )}
        </div>
        {parent === null ? null : (
          <p className="text-sm text-muted-foreground">
            {t('panel.apartments.partOf', { name: parent.name })}
          </p>
        )}
      </header>

      <Tabs value={current} onValueChange={(next) => setTab(next as CardTab)}>
        <TabsList className="h-auto">
          {CARD_TABS.map((name) => (
            <TabsTrigger key={name} value={name} className="min-h-11 px-3">
              {t(`panel.apartments.card.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="info" className="pt-4">
          <InfoTab property={one} all={all} />
        </TabsContent>
        <TabsContent value="cleaners" className="pt-4">
          <CleanersTab propertyId={one.id} listing={listing} />
        </TabsContent>
        <TabsContent value="checklist" className="pt-4">
          <ChecklistTab propertyId={one.id} all={all} listing={listing} />
        </TabsContent>
        <TabsContent value="bookings" className="pt-4">
          <BookingsTab propertyId={one.id} listing={listing} />
        </TabsContent>
        <TabsContent value="maintenance" className="pt-4">
          <MaintenanceTab property={one} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
