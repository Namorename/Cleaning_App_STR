'use client';

import { ChevronDown, ChevronRight, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { propertyPath } from '@str-ops/shared';

import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import type { PropertyNode } from '@/lib/property-tree';

import { ListingLink } from './listing-link';
import { childrenOf, isRoom, parentOf, type Property, type PropertyStatus } from './schema';

interface RegistryRowProps {
  node: PropertyNode<Property>;
  depth: number;
  all: Property[];
  /** Where this row can be sent from the tab it is read in. */
  moves: readonly PropertyStatus[];
  cleanings: number;
  isTicked: boolean;
  isClosed: boolean;
  /** Its card is the one open beside the registry. */
  isOpen: boolean;
  onTick: (isOn: boolean) => void;
  onToggleGroup: () => void;
  onMove: (status: PropertyStatus) => void;
}

/**
 * One row of the registry (5.4, variant B): a listing, or a room or part
 * under it — narrow enough to stand beside the card.
 *
 * The name opens the card; under it, quietly, where the flat is, what it is
 * linked to and its Hostaway id. The moves between states wait in the row's
 * menu «⋯» — they were two look-alike buttons in every row.
 *
 * A room has no tick (trap 6) and no cleanings of its own — the listing's
 * number already holds them (trap 4). A room standing alone in a tab its
 * listing is not in names the house too (trap 3).
 */
export function RegistryRow({
  node,
  depth,
  all,
  moves,
  cleanings,
  isTicked,
  isClosed,
  isOpen,
  onTick,
  onToggleGroup,
  onMove,
}: RegistryRowProps) {
  const { t } = useTranslation();
  const property = node.row;
  const room = isRoom(property);
  const parent = node.isDetached ? parentOf(all, property) : null;
  const name = parent === null ? property.name : propertyPath(parent.name, property.name);
  const where = [property.address, property.city].filter((part) => part !== null).join(', ');

  return (
    <TableRow data-state={isOpen ? 'selected' : undefined}>
      <TableCell className="w-11 p-0">
        {room ? null : (
          <label className="flex size-11 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              className="size-4"
              aria-label={property.name}
              checked={isTicked}
              onChange={(event) => onTick(event.target.checked)}
            />
          </label>
        )}
      </TableCell>
      <TableCell className="py-1 whitespace-normal">
        <div className={depth > 0 ? 'pl-6' : undefined}>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
            {node.children.length === 0 ? null : (
              <Button
                type="button"
                variant="ghost"
                className="-ml-2 size-11"
                aria-expanded={!isClosed}
                aria-label={t(
                  isClosed ? 'panel.apartments.tree.expand' : 'panel.apartments.tree.collapse',
                  { name: property.name },
                )}
                onClick={onToggleGroup}
              >
                {isClosed ? (
                  <ChevronRight aria-hidden="true" />
                ) : (
                  <ChevronDown aria-hidden="true" />
                )}
              </Button>
            )}
            <ListingLink
              id={property.id}
              isCurrent={isOpen}
              className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline aria-[current=true]:underline"
            >
              {name}
            </ListingLink>
            {property.status === 'active' ? null : (
              <StatusBadge status={`property.${property.status}`}>
                {t(`panel.apartments.tabs.${property.status}`)}
              </StatusBadge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {where === '' ? null : <span>{where}</span>}
            <LinkedListings all={all} property={property} />
            <span className="tabular-nums">{property.id}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {room ? <span title={t('panel.apartments.room.cleanings')}>—</span> : cleanings}
      </TableCell>
      <TableCell className="w-11 p-0 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="ghost" className="size-11" />}
            aria-label={t('panel.apartments.rowMenu', { name: property.name })}
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {moves.map((status) => (
              <DropdownMenuItem
                key={status}
                variant={status === 'archived' ? 'destructive' : 'default'}
                onClick={() => onMove(status)}
              >
                {t(`panel.apartments.move.${status}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
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
  return null;
}
