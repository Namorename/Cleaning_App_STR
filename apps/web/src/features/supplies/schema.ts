import { z } from 'zod';

import { todayIso } from '@/lib/format-date';

export const SUPPLY_UNITS = ['pcs', 'pack', 'l', 'kg', 'roll'] as const;
export type SupplyUnit = (typeof SUPPLY_UNITS)[number];

export const SUPPLY_PRIORITIES = ['normal', 'urgent'] as const;
export type SupplyPriority = (typeof SUPPLY_PRIORITIES)[number];

export const SUPPLY_STATUSES = ['new', 'accepted', 'ordered', 'fulfilled', 'rejected'] as const;
export type SupplyStatus = (typeof SUPPLY_STATUSES)[number];

export const supplyItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  // numeric travels as a string over the wire.
  quantity: z.coerce.number(),
  unit: z.enum(SUPPLY_UNITS),
  comment: z.string().nullable(),
  sort_order: z.number(),
  /** The catalogue entry the line was picked from; null when typed by hand. */
  catalog_item_id: z.uuid().nullable().default(null),
});
export type SupplyItem = z.infer<typeof supplyItemSchema>;

/** An entry of the company's catalogue: what the phone offers instead of a blank field. */
export const catalogItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  name_i18n: z.record(z.string(), z.string()).catch({}).default({}),
  unit: z.enum(SUPPLY_UNITS),
  sort_order: z.number(),
  archived_at: z.string().nullable(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export const catalogItemListSchema = z.array(catalogItemSchema);

/** The entry's name for a reader: her language when translated, the company's words otherwise. */
export function catalogItemName(item: Pick<CatalogItem, 'name' | 'name_i18n'>, language: string): string {
  const translated = item.name_i18n[language];
  return translated !== undefined && translated.trim() !== '' ? translated : item.name;
}

export function isCatalogItemArchived(item: Pick<CatalogItem, 'archived_at'>): boolean {
  return item.archived_at !== null;
}

/** What the editor sends: the id is minted on the panel so a retry replays. */
export interface CatalogItemDraft {
  id: string;
  name: string;
  name_i18n: Record<string, string>;
  unit: SupplyUnit;
}

const personSchema = z
  .object({ full_name: z.string().nullable(), role: z.string().nullable().default(null) })
  .nullable();

/** A request as the manager reads it: the row, its lines, and the names around it. */
export const supplyRequestSchema = z.object({
  id: z.uuid(),
  requested_by: z.uuid(),
  property_id: z.number().nullable(),
  task_id: z.uuid().nullable(),
  status: z.enum(SUPPLY_STATUSES),
  priority: z.enum(SUPPLY_PRIORITIES),
  note: z.string().nullable(),
  needed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  fulfilled_at: z.string().nullable(),
  reject_reason: z.string().nullable(),
  created_at: z.string(),
  property: z.object({ name: z.string() }).nullable().optional(),
  requester: personSchema.optional(),
  items: z.array(supplyItemSchema).default([]),
});
export type SupplyRequest = z.infer<typeof supplyRequestSchema>;
export const supplyRequestListSchema = z.array(supplyRequestSchema);

/**
 * The day a request was made, as the manager reads it.
 *
 * `created_at` is an instant; the filter is a calendar day, and the day it
 * belongs to is the reader's, not UTC's — otherwise a request made at half
 * past midnight in Prague falls out of a search for that date.
 */
export function requestDay(request: Pick<SupplyRequest, 'created_at'>): string {
  return todayIso(new Date(request.created_at));
}

/** `YYYY-MM-DD` at both ends, inclusive; an empty string is an open end. */
export interface DateRange {
  from: string;
  to: string;
}

export const EMPTY_DATE_RANGE: DateRange = { from: '', to: '' };

export function isInDateRange(request: Pick<SupplyRequest, 'created_at'>, range: DateRange): boolean {
  const day = requestDay(request);
  if (range.from !== '' && day < range.from) {
    return false;
  }
  return range.to === '' || day <= range.to;
}

/** The page's tabs; "all" is the only one that shows rejected requests. */
export const SUPPLY_TABS = ['new', 'inProgress', 'fulfilled', 'all'] as const;
export type SupplyTab = (typeof SUPPLY_TABS)[number];

const TAB_STATUSES: Record<SupplyTab, readonly SupplyStatus[] | null> = {
  new: ['new'],
  inProgress: ['accepted', 'ordered'],
  fulfilled: ['fulfilled'],
  all: null,
};

export function isInTab(request: Pick<SupplyRequest, 'status'>, tab: SupplyTab): boolean {
  const statuses = TAB_STATUSES[tab];
  return statuses === null || statuses.includes(request.status);
}

/** The forward moves the server accepts from a status, in the order the buttons show. */
export function nextStatuses(status: SupplyStatus): SupplyStatus[] {
  switch (status) {
    case 'new':
      return ['accepted'];
    case 'accepted':
      return ['ordered', 'fulfilled'];
    case 'ordered':
      return ['fulfilled'];
    case 'fulfilled':
    case 'rejected':
      return [];
  }
}

export function canReject(status: SupplyStatus): boolean {
  return status === 'new' || status === 'accepted' || status === 'ordered';
}

/** Lines in the order the cleaner entered them. */
export function sortedItems(request: Pick<SupplyRequest, 'items'>): SupplyItem[] {
  return request.items.slice().sort((a, b) => a.sort_order - b.sort_order);
}

/** The statuses the summary can count: what is still on its way to being bought. */
export const PURCHASE_SCOPE_STATUSES: readonly SupplyStatus[] = ['new', 'accepted', 'ordered'];
export const DEFAULT_PURCHASE_SCOPE: readonly SupplyStatus[] = ['new', 'accepted'];

export interface PurchaseLine {
  /** Lower-cased name plus unit: what "the same item" means here. */
  key: string;
  /** The name as first written. */
  name: string;
  unit: SupplyUnit;
  quantity: number;
  /** Listing names, distinct; null stands for a general request. */
  sources: (string | null)[];
  /** Distinct requests that asked for this item, however many lines each had. */
  requestCount: number;
}

interface PurchaseAccumulator extends Omit<PurchaseLine, 'requestCount'> {
  requestIds: string[];
}

function lineKey(name: string, unit: SupplyUnit): string {
  return `${name.trim().toLocaleLowerCase().replace(/\s+/g, ' ')}|${unit}`;
}

/** Round away the float dust that adding 0.1s leaves behind; the database keeps two decimals. */
function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The same item across requests, added up.
 *
 * Two lines are the same when their names match ignoring case and spacing
 * and their units match: "Мешки 60 л" and "мешки 60 л" are one row, a litre
 * and a pack of the same thing are two.
 */
export function aggregatePurchase(
  requests: readonly SupplyRequest[],
  statuses: readonly SupplyStatus[],
): PurchaseLine[] {
  const lines = new Map<string, PurchaseAccumulator>();
  for (const request of requests) {
    if (!statuses.includes(request.status)) {
      continue;
    }
    const source = request.property?.name ?? null;
    for (const item of request.items) {
      const key = lineKey(item.name, item.unit);
      const existing = lines.get(key);
      if (existing === undefined) {
        lines.set(key, {
          key,
          name: item.name.trim(),
          unit: item.unit,
          quantity: item.quantity,
          sources: [source],
          requestIds: [request.id],
        });
        continue;
      }
      lines.set(key, {
        ...existing,
        quantity: existing.quantity + item.quantity,
        sources: existing.sources.includes(source)
          ? existing.sources
          : [...existing.sources, source],
        requestIds: existing.requestIds.includes(request.id)
          ? existing.requestIds
          : [...existing.requestIds, request.id],
      });
    }
  }
  return [...lines.values()]
    .map(({ requestIds, ...line }) => ({
      ...line,
      quantity: roundQuantity(line.quantity),
      requestCount: requestIds.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
