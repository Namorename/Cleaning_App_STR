import { propertyPath } from '@str-ops/shared';

import type { Place } from './schema';

export interface PlaceIndex {
  readonly byId: ReadonlyMap<number, Place>;
  readonly childrenOf: ReadonlyMap<number, readonly number[]>;
}

export function placeIndex(places: readonly Place[]): PlaceIndex {
  const byId = new Map(places.map((place) => [place.id, place]));
  const childrenOf = new Map<number, number[]>();
  for (const place of places) {
    if (place.parent_id !== null) {
      childrenOf.set(place.parent_id, [...(childrenOf.get(place.parent_id) ?? []), place.id]);
    }
  }
  return { byId, childrenOf };
}

/**
 * A place as the panel writes it: a room with its house (a room's own name
 * never says which), anything else by its name. Null for a place the reader
 * does not see — the head technician reads the places of his tasks only.
 */
export function placeLabel(index: PlaceIndex, id: number): string | null {
  const place = index.byId.get(id);
  if (place === undefined) {
    return null;
  }
  const parent = place.parent_id === null ? undefined : index.byId.get(place.parent_id);
  return place.hostaway_unit_id !== null && parent !== undefined
    ? propertyPath(parent.name, place.name)
    : place.name;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The buildings an article may be about: listings with rooms or parts under them, by name. */
export function buildingsOf(places: readonly Place[]): Place[] {
  const parents = new Set(places.flatMap((place) => (place.parent_id === null ? [] : [place.parent_id])));
  return places
    .filter((place) => place.parent_id === null && parents.has(place.id))
    .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
}

/**
 * Whether an article with these places is about a place: names it, names the
 * house it is a room of, or names a room of it — the way the phone will show
 * a house's article in its rooms (20261030100000).
 */
export function articleTouchesPlace(
  targetIds: readonly number[],
  placeId: number,
  index: PlaceIndex,
): boolean {
  const parentId = index.byId.get(placeId)?.parent_id ?? null;
  const rooms = new Set(index.childrenOf.get(placeId) ?? []);
  return targetIds.some((id) => id === placeId || id === parentId || rooms.has(id));
}
