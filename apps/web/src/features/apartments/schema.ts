import { z } from 'zod';

/**
 * What a listing is doing, in the company's words.
 *
 * `active` earns cleanings. `maintenance` is a flat under repair: the schedule
 * stops, but the flat is still the company's and a technician still goes there.
 * `archived` has left the business — and an archived listing is not supposed to
 * turn up anywhere except the one tab it can be brought back from.
 */
export const PROPERTY_STATUSES = ['active', 'maintenance', 'archived'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

/**
 * A row of the registry.
 *
 * `status` falls back rather than throws: a value added by a later migration
 * must not blank the whole list. It falls back to `active` — the reading that
 * shows the row rather than hiding it, because a listing nobody can see is a
 * listing nobody can fix.
 */
export const propertySchema = z.object({
  id: z.number(),
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  status: z.enum(PROPERTY_STATUSES).catch('active'),
  parent_id: z.number().nullable(),
  bedrooms: z.number().nullable(),
  max_guests: z.number().nullable(),
});
export type Property = z.infer<typeof propertySchema>;
export const propertyListSchema = z.array(propertySchema);

/** What a sync run reports back. Skipped listings carry their own reason. */
export const syncSummarySchema = z.object({
  fetched: z.number(),
  normalized: z.number(),
  skipped: z.array(z.object({ position: z.number(), reason: z.string() })),
  propertiesInserted: z.number(),
  propertiesUpdated: z.number(),
  durationMs: z.number(),
});
export type SyncSummary = z.infer<typeof syncSummarySchema>;

// ---------------------------------------------------------------------------
//  Narrowing the registry
// ---------------------------------------------------------------------------

/**
 * The tabs, which are the statuses.
 *
 * `active` is first and is where the registry opens: an archived listing is
 * never part of the default view, which is the whole point of archiving it.
 */
export const APARTMENT_TABS = PROPERTY_STATUSES;
export type ApartmentTab = PropertyStatus;

export function isInTab(property: Property, tab: ApartmentTab): boolean {
  return property.status === tab;
}

/**
 * Token search: every word has to be found, none has to be found first.
 *
 * A manager types what she remembers — half a street, a city, a listing number
 * off a booking — in whatever order it comes to her. Requiring all the tokens
 * and caring about none of their order is what makes "vinohrady 12" and
 * "12 vinohrady" the same search.
 */
export function matchesTokens(property: Property, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter((token) => token !== '');
  if (tokens.length === 0) {
    return true;
  }

  const haystack = [property.name, property.address, property.city, String(property.id)]
    .filter((field): field is string => field !== null && field !== '')
    .join(' ')
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
}

// ---------------------------------------------------------------------------
//  Listings that belong together
// ---------------------------------------------------------------------------

/**
 * The units a combined listing is made of.
 *
 * Hostaway sells a whole flat and its rooms as separate listings, and a
 * booking on the combined one would otherwise produce a cleaning for each —
 * the reason `parent_id` exists at all.
 */
export function childrenOf(properties: Property[], parentId: number): Property[] {
  return properties.filter((property) => property.parent_id === parentId);
}

export function parentOf(properties: Property[], property: Property): Property | null {
  if (property.parent_id === null) {
    return null;
  }
  return properties.find((candidate) => candidate.id === property.parent_id) ?? null;
}

// ---------------------------------------------------------------------------
//  Taking listings out of service
// ---------------------------------------------------------------------------

/** Cleanings nobody has started, by listing — what taking one out would sweep. */
export function openCleaningsBy(rows: { property_id: number }[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.property_id, (counts.get(row.property_id) ?? 0) + 1);
  }
  return counts;
}

export function openCleaningsOf(counts: Map<number, number>, ids: readonly number[]): number {
  return ids.reduce((total, id) => total + (counts.get(id) ?? 0), 0);
}

/** A status change only means something for listings that are not already in it. */
export function needsChange(
  properties: Property[],
  ids: readonly number[],
  next: PropertyStatus,
): number[] {
  const wanted = new Set(ids);
  return properties
    .filter((property) => wanted.has(property.id) && property.status !== next)
    .map((property) => property.id);
}
