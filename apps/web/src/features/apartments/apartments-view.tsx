'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { serverErrorText } from '@/lib/server-error';

import {
  APARTMENT_TABS,
  childrenOf,
  isInTab,
  matchesTokens,
  needsChange,
  openCleaningsBy,
  openCleaningsOf,
  parentOf,
  type ApartmentTab,
  type Property,
  type PropertyStatus,
} from './schema';
import { StatusDialog, type StatusSubject } from './status-dialog';
import { useOpenCleanings, useRegistry, useSyncListings } from './use-apartments';

/** Where a listing can be sent from each tab. */
const MOVES: Readonly<Record<ApartmentTab, readonly PropertyStatus[]>> = {
  active: ['maintenance', 'archived'],
  maintenance: ['active', 'archived'],
  archived: ['active'],
};

/**
 * The registry of listings.
 *
 * Three tabs, which are the three states, and it opens on the working ones: an
 * archived listing appears in exactly one place in the whole panel — the tab it
 * can be brought back from. Everywhere else asks the database for
 * `status <> 'archived'`.
 *
 * There is no delete. A flat that has been cleaned two hundred times carries
 * that history on its rows, and archiving keeps every bit of it while taking
 * the listing out of the way.
 */
export function ApartmentsView() {
  const { t } = useTranslation();
  const registry = useRegistry();
  const cleanings = useOpenCleanings();
  const sync = useSyncListings();

  const [tab, setTab] = useState<ApartmentTab>('active');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [subject, setSubject] = useState<StatusSubject | null>(null);

  const all = useMemo(() => registry.data ?? [], [registry.data]);
  const openBy = useMemo(() => openCleaningsBy(cleanings.data ?? []), [cleanings.data]);

  const found = all.filter((property) => matchesTokens(property, search));
  const shown = found.filter((property) => isInTab(property, tab));

  // A tick that scrolls out of sight when the tab or the search changes would
  // act on a listing nobody can see, so the selection is kept to what is shown.
  const selected = picked.filter((id) => shown.some((property) => property.id === id));
  const syncFailure = sync.isError ? serverErrorText(sync.error) : null;

  const toggle = (id: number, isOn: boolean) => {
    setPicked(isOn ? [...selected, id] : selected.filter((current) => current !== id));
  };

  const ask = (status: PropertyStatus, ids: number[]) => {
    const moving = needsChange(all, ids, status);
    if (moving.length === 0) {
      return;
    }
    setSubject({
      ids: moving,
      status,
      names: all.filter((property) => moving.includes(property.id)).map((property) => property.name),
      openCleanings: openCleaningsOf(openBy, moving),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('panel.nav.apartments')}</h1>
        <Button type="button" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? t('panel.apartments.sync.running') : t('panel.apartments.sync.start')}
        </Button>
      </div>

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
            <span className="text-destructive">
              {t('panel.apartments.sync.skipped', { total: sync.data.skipped.length })}{' '}
              {sync.data.skipped.map((one) => one.reason).join('; ')}
            </span>
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

      <Input
        className="max-w-md"
        placeholder={t('panel.apartments.search')}
        aria-label={t('panel.apartments.search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <Tabs value={tab} onValueChange={(next) => setTab(next as ApartmentTab)}>
        <TabsList>
          {APARTMENT_TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`panel.apartments.tabs.${name}`)} (
              {found.filter((property) => isInTab(property, name)).length})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {selected.length === 0 ? null : (
        <div
          role="group"
          aria-label={t('panel.apartments.bulkActions')}
          className="flex flex-wrap items-center gap-2 rounded-md border p-2"
        >
          <span className="text-sm">
            {t('panel.apartments.selected', { total: selected.length })}
          </span>
          {MOVES[tab].map((status) => (
            <Button
              key={status}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => ask(status, selected)}
            >
              {t(`panel.apartments.move.${status}`)}
            </Button>
          ))}
        </div>
      )}

      {registry.isPending ? (
        <p className="text-sm text-muted-foreground">{t('panel.apartments.loading')}</p>
      ) : registry.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.apartments.loadError')}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel.apartments.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{t('panel.apartments.columns.name')}</TableHead>
              <TableHead>{t('panel.apartments.columns.address')}</TableHead>
              <TableHead>{t('panel.apartments.columns.linked')}</TableHead>
              <TableHead>{t('panel.apartments.columns.cleanings')}</TableHead>
              <TableHead className="text-right">{t('panel.apartments.columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((property) => (
              <TableRow key={property.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    className="size-4"
                    aria-label={property.name}
                    checked={selected.includes(property.id)}
                    onChange={(event) => toggle(property.id, event.target.checked)}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="font-medium underline" href={`/apartments/${property.id}`}>
                      {property.name}
                    </Link>
                    {property.status === 'active' ? null : (
                      <Badge variant="outline">
                        {t(`panel.apartments.tabs.${property.status}`)}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{property.id}</span>
                </TableCell>
                <TableCell className="text-sm">
                  {[property.address, property.city].filter((part) => part !== null).join(', ') ||
                    '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <LinkedListings all={all} property={property} />
                </TableCell>
                <TableCell className="text-sm">{openBy.get(property.id) ?? 0}</TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {MOVES[tab].map((status) => (
                      <Button
                        key={status}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => ask(status, [property.id])}
                      >
                        {t(`panel.apartments.move.${status}`)}
                      </Button>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {subject === null ? null : <StatusDialog subject={subject} onClose={() => setSubject(null)} />}
    </div>
  );
}

interface LinkedListingsProps {
  all: Property[];
  property: Property;
}

/** A combined listing names its units; a unit names the listing it belongs to. */
function LinkedListings({ all, property }: LinkedListingsProps) {
  const { t } = useTranslation();
  const parent = parentOf(all, property);
  const children = childrenOf(all, property.id);

  if (parent !== null) {
    return <span>{t('panel.apartments.partOf', { name: parent.name })}</span>;
  }
  if (children.length > 0) {
    return <span>{t('panel.apartments.madeOf', { total: children.length })}</span>;
  }
  return <span>—</span>;
}
