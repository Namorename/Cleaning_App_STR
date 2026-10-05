'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buildPropertyTree, visibleRows } from '@/lib/property-tree';

import { RegistryRow } from './registry-row';
import {
  APARTMENT_TABS,
  isRoom,
  needsChange,
  openCleaningsBy,
  openCleaningsOf,
  registryRows,
  type ApartmentTab,
  type PropertyStatus,
} from './schema';
import type { StatusSubject } from './status-dialog';
import { useOpenCleanings, useRegistry } from './use-apartments';

/** Where a listing can be sent from each tab. */
const MOVES: Readonly<Record<ApartmentTab, readonly PropertyStatus[]>> = {
  active: ['maintenance', 'archived'],
  maintenance: ['active', 'archived'],
  archived: ['active'],
};

interface RegistryProps {
  tab: ApartmentTab;
  search: string;
  /** The listing whose card is open beside the registry. */
  openListing: number | null;
  onTabChange: (tab: ApartmentTab) => void;
  onSearchChange: (search: string) => void;
  /** Ask before listings change state: the dialog is the view's. */
  onAsk: (subject: StatusSubject) => void;
}

/**
 * The registry of listings: the three tabs, which are the three states, the
 * search, the ticks and their bulk moves, and the rows with rooms under their
 * listing.
 *
 * It opens on the working ones: an archived listing appears in exactly one
 * place in the whole panel — the tab it can be brought back from. There is no
 * delete: archiving keeps a flat's history while taking it out of the way.
 */
export function Registry({
  tab,
  search,
  openListing,
  onTabChange,
  onSearchChange,
  onAsk,
}: RegistryProps) {
  const { t } = useTranslation();
  const registry = useRegistry();
  const cleanings = useOpenCleanings();
  const [picked, setPicked] = useState<number[]>([]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());

  const all = useMemo(() => registry.data ?? [], [registry.data]);
  const openBy = useMemo(() => openCleaningsBy(cleanings.data ?? []), [cleanings.data]);
  const isSearching = search.trim() !== '';

  // Rooms hang under their listing (docs/f10-plan.md, 7.1). While a search is
  // on every group stays open: a room found by name has to be seen.
  const tree = buildPropertyTree(registryRows(all, tab, search));
  const rows = visibleRows(tree, isSearching ? new Set<number>() : collapsed);
  const shown = rows.map((one) => one.node.row);

  // A tick that scrolls out of sight when the tab or the search changes would
  // act on a listing nobody can see, so the selection is kept to what is shown.
  // A room has no tick at all (trap 6).
  const selected = picked.filter((id) =>
    shown.some((property) => property.id === id && !isRoom(property)),
  );

  const toggle = (id: number, isOn: boolean) => {
    setPicked(isOn ? [...selected, id] : selected.filter((current) => current !== id));
  };

  const toggleGroup = (id: number) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const ask = (status: PropertyStatus, ids: number[]) => {
    const moving = needsChange(all, ids, status);
    if (moving.length === 0) {
      return;
    }
    onAsk({
      ids: moving,
      status,
      names: all
        .filter((property) => moving.includes(property.id))
        .map((property) => property.name),
      openCleanings: openCleaningsOf(openBy, moving),
    });
  };

  return (
    <>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          className="h-11 pl-9"
          placeholder={t('panel.apartments.search')}
          aria-label={t('panel.apartments.search')}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <Tabs value={tab} onValueChange={(next) => onTabChange(next as ApartmentTab)}>
        <TabsList className="h-auto">
          {APARTMENT_TABS.map((name) => (
            <TabsTrigger key={name} value={name} className="min-h-11 px-3">
              {t(`panel.apartments.tabs.${name}`)} (
              {buildPropertyTree(registryRows(all, name, search)).length})
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
              className="h-11"
              onClick={() => ask(status, selected)}
            >
              {t(`panel.apartments.move.${status}`)}
            </Button>
          ))}
        </div>
      )}

      {registry.isPending ? (
        <LoadingState>{t('panel.apartments.loading')}</LoadingState>
      ) : registry.isError && registry.data === undefined ? (
        <ErrorState message={t('panel.apartments.loadError')} error={registry.error} />
      ) : shown.length === 0 ? (
        <EmptyState>{t('panel.apartments.empty')}</EmptyState>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-11">
                  <span className="sr-only">{t('panel.apartments.columns.pick')}</span>
                </TableHead>
                <TableHead>{t('panel.apartments.columns.name')}</TableHead>
                <TableHead className="text-right">
                  {t('panel.apartments.columns.cleanings')}
                </TableHead>
                <TableHead className="w-11">
                  <span className="sr-only">{t('panel.apartments.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ node, depth }) => (
                <RegistryRow
                  key={node.row.id}
                  node={node}
                  depth={depth}
                  all={all}
                  moves={MOVES[tab]}
                  cleanings={openBy.get(node.row.id) ?? 0}
                  isTicked={selected.includes(node.row.id)}
                  isClosed={collapsed.has(node.row.id) && !isSearching}
                  isOpen={openListing === node.row.id}
                  onTick={(isOn) => toggle(node.row.id, isOn)}
                  onToggleGroup={() => toggleGroup(node.row.id)}
                  onMove={(status) => ask(status, [node.row.id])}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
