'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { CleanersTab } from './cleaners-tab';
import { InfoTab } from './info-tab';
import { parentOf } from './schema';
import { useProperty, useRegistry } from './use-apartments';

/** The sections of the card, in the order the plan builds them. */
const CARD_TABS = ['info', 'cleaners'] as const;
type CardTab = (typeof CARD_TABS)[number];

interface PropertyCardProps {
  propertyId: number;
}

/**
 * One flat, everything the company knows about it.
 *
 * Reached from the registry, including from the archive tab — a manager about
 * to bring a listing back should be able to look at it first, so an archived
 * flat opens here like any other and says so at the top.
 */
export function PropertyCard({ propertyId }: PropertyCardProps) {
  const { t } = useTranslation();
  const property = useProperty(propertyId);
  const registry = useRegistry();
  const [tab, setTab] = useState<CardTab>('info');

  const all = registry.data ?? [];

  if (property.isPending) {
    return <p className="text-sm text-muted-foreground">{t('panel.apartments.loading')}</p>;
  }
  if (property.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('panel.apartments.loadError')}
      </p>
    );
  }
  if (property.data === null || property.data === undefined) {
    return <p className="text-sm text-muted-foreground">{t('panel.apartments.notFound')}</p>;
  }

  const one = property.data;
  const parent = parentOf(all, one);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link className="text-sm text-muted-foreground underline" href="/apartments">
          {t('panel.apartments.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{one.name}</h1>
          {one.status === 'active' ? null : (
            <Badge variant="outline">{t(`panel.apartments.tabs.${one.status}`)}</Badge>
          )}
        </div>
        {parent === null ? null : (
          <span className="text-sm text-muted-foreground">
            {t('panel.apartments.partOf', { name: parent.name })}
          </span>
        )}
      </div>

      <Tabs value={tab} onValueChange={(next) => setTab(next as CardTab)}>
        <TabsList>
          {CARD_TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`panel.apartments.card.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="info" className="pt-4">
          <InfoTab property={one} all={all} />
        </TabsContent>
        <TabsContent value="cleaners" className="pt-4">
          <CleanersTab propertyId={one.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
