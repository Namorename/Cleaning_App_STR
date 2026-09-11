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

/**
 * One listing in full, as its card shows it.
 *
 * The fields split in two, and the card says which is which. Everything
 * Hostaway knows — the name, the address, the size, the check-in and check-out
 * hours — is rewritten by every sync (`sync_hostaway_listings` sets them from
 * `excluded`), so the panel shows those and does not offer to edit them: a box
 * whose contents vanish overnight is worse than a line of text.
 *
 * What the company knows about the flat — the notes and which listing it is a
 * unit of — is ours, absent from that update list, and editable here.
 */
export const propertyDetailSchema = propertySchema.extend({
  country_code: z.string().nullable(),
  timezone: z.string(),
  bathrooms: z.number().nullable(),
  check_in_time: z.string().nullable(),
  check_out_time: z.string().nullable(),
  cleaner_notes: z.string().nullable(),
  internal_notes: z.string().nullable(),
  synced_at: z.string().nullable(),
});
export type PropertyDetail = z.infer<typeof propertyDetailSchema>;

/** The half of a listing the panel may write. */
export interface InfoDraft {
  parentId: number | null;
  cleanerNotes: string;
  internalNotes: string;
}

export function infoDraftFrom(property: PropertyDetail): InfoDraft {
  return {
    parentId: property.parent_id,
    cleanerNotes: property.cleaner_notes ?? '',
    internalNotes: property.internal_notes ?? '',
  };
}

/**
 * Listings this one could be a unit of.
 *
 * Not itself, and not one of its own units: either would make a loop, and a
 * loop in the parent chain is how a booking turns into an endless hunt for
 * which flat to clean. Archived listings are out — a live unit hanging off a
 * listing the company no longer has is a link nobody will act on.
 */
export function possibleParents(all: Property[], property: Property): Property[] {
  const units = new Set(childrenOf(all, property.id).map((child) => child.id));
  return all.filter(
    (candidate) =>
      candidate.id !== property.id &&
      !units.has(candidate.id) &&
      candidate.status !== 'archived',
  );
}

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

/**
 * A booking as the card shows it.
 *
 * `is_block` is not a guest: Hostaway calls an owner stay or a maintenance
 * window a reservation too, and those produce no cleaning. The card says which
 * is which rather than leaving a nameless row that looks like a lost booking.
 */
export const reservationSchema = z.object({
  id: z.number(),
  arrival_date: z.string(),
  departure_date: z.string(),
  guest_name: z.string().nullable(),
  guests_count: z.number().nullable(),
  status: z.string(),
  is_block: z.boolean(),
});
export type Reservation = z.infer<typeof reservationSchema>;
export const reservationListSchema = z.array(reservationSchema);

/** A technician's job on this flat. */
export const maintenanceTaskSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  scheduled_date: z.string().nullable(),
  completed_at: z.string().nullable(),
  assignee: z.object({ full_name: z.string().nullable() }).nullable(),
});
export type MaintenanceTask = z.infer<typeof maintenanceTaskSchema>;
export const maintenanceTaskListSchema = z.array(maintenanceTaskSchema);

/** A report from the field about this flat. */
export const propertyProblemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
});
export type PropertyProblem = z.infer<typeof propertyProblemSchema>;
export const propertyProblemListSchema = z.array(propertyProblemSchema);

// ---------------------------------------------------------------------------
//  The checklist
// ---------------------------------------------------------------------------

/**
 * What the snapshot hands back.
 *
 * Ids are there for what already exists and absent for what the editor has
 * just invented — `save_property_checklist` reads a missing id as "insert" and
 * a known one as "update", and drops anything the payload no longer mentions.
 */
export const checklistItemSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  is_optional: z.boolean(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistModuleSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  items: z.array(checklistItemSchema).nullable().transform((items) => items ?? []),
});
export type ChecklistModule = z.infer<typeof checklistModuleSchema>;

export const checklistSchema = z.object({ modules: z.array(checklistModuleSchema) });

/** A blank line the editor gives you to type into. */
export function emptyModule(): ChecklistModule {
  return { title: '', items: [] };
}

export function emptyItem(): ChecklistItem {
  return { title: '', is_optional: false };
}

/** Immutable edits — the list is rebuilt, never poked at in place. */
export function replaceModule(
  modules: ChecklistModule[],
  index: number,
  next: ChecklistModule,
): ChecklistModule[] {
  return modules.map((module, at) => (at === index ? next : module));
}

export function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, at) => at !== index);
}

/**
 * Move one entry up or down.
 *
 * Order is the whole meaning here: `save_property_checklist` writes
 * `sort_order` from the position in the array, and a cleaner reads the list
 * top to bottom. A move off either end is not an error, it is simply nothing.
 */
export function moveAt<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) {
    return list;
  }
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * What may be saved.
 *
 * A module with no items is dropped by the snapshot on the way back anyway
 * (it only returns modules that have items), so saving one would make a line
 * that silently disappears. Blank titles are the same kind of trap.
 */
export function checklistProblem(modules: ChecklistModule[]): 'blankTitle' | 'emptyModule' | null {
  for (const section of modules) {
    if (section.title.trim() === '') {
      return 'blankTitle';
    }
    if (section.items.length === 0) {
      return 'emptyModule';
    }
    if (section.items.some((item) => item.title.trim() === '')) {
      return 'blankTitle';
    }
  }
  return null;
}

/** Trimmed, and without the keys the server would only have to ignore. */
export function checklistPayload(modules: ChecklistModule[]): unknown[] {
  return modules.map((section) => ({
    ...(section.id === undefined ? {} : { id: section.id }),
    title: section.title.trim(),
    items: section.items.map((item) => ({
      ...(item.id === undefined ? {} : { id: item.id }),
      title: item.title.trim(),
      is_optional: item.is_optional,
    })),
  }));
}

/** A booking that has not ended yet is the half a manager is usually after. */
export function isUpcoming(reservation: Reservation, today: string): boolean {
  return reservation.departure_date >= today;
}

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
