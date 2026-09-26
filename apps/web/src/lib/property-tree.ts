/**
 * Listings, their rooms and their parts as one tree — the same for the
 * registry and the calendar (docs/f10-plan.md, §3).
 *
 * `parent_id` carries two relationships, and `hostaway_unit_id` tells them
 * apart (docs/units-plan.md, «Решения»):
 * - a room of a multi-unit listing has a `hostaway_unit_id`: Hostaway books the
 *   listing and names the rooms, the cleaning stands on the room;
 * - a part of a combined listing (a villa) has none: it is a listing of its
 *   own, with its own bookings and cleanings.
 *
 * `guard_property_hierarchy` keeps the tree two levels deep, but nothing here
 * depends on that: children are built the same way at any depth, so a row is
 * never silently dropped.
 */

export type PropertyKind = 'listing' | 'multiUnit' | 'villa' | 'room' | 'part';

/** What the tree needs of a row; the rest of the row travels untouched. */
export interface TreeRow {
  id: number;
  name: string;
  parent_id: number | null;
  hostaway_unit_id: number | null;
}

export interface PropertyNode<T extends TreeRow> {
  readonly row: T;
  readonly kind: PropertyKind;
  /** Rooms first, then parts, each by name the way a person counts. */
  readonly children: readonly PropertyNode<T>[];
  /**
   * A room or a part whose listing is not among the rows given — in another
   * registry tab, say. It stands on its own rather than disappearing.
   */
  readonly isDetached: boolean;
}

export interface VisibleRow<T extends TreeRow> {
  readonly node: PropertyNode<T>;
  /** 0 for a listing, 1 for a room or a part under it. */
  readonly depth: number;
}

// "Unit 3" before "Unit 10", and "listing 2" next to "Listing 10".
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function byName<T extends TreeRow>(a: T, b: T): number {
  return collator.compare(a.name, b.name) || a.id - b.id;
}

function isRoomRow(row: TreeRow): boolean {
  return row.hostaway_unit_id !== null;
}

function childKind(row: TreeRow): PropertyKind {
  return isRoomRow(row) ? 'room' : 'part';
}

function nodeOf<T extends TreeRow>(
  row: T,
  childrenOf: ReadonlyMap<number, readonly T[]>,
  isDetached: boolean,
): PropertyNode<T> {
  const kids = childrenOf.get(row.id) ?? [];
  const rooms = kids.filter(isRoomRow).sort(byName);
  const parts = kids.filter((kid) => !isRoomRow(kid)).sort(byName);
  const children = [...rooms, ...parts].map((kid) => nodeOf(kid, childrenOf, false));

  const kind: PropertyKind =
    row.parent_id !== null
      ? childKind(row)
      : parts.length > 0
        ? 'villa'
        : rooms.length > 0
          ? 'multiUnit'
          : 'listing';

  return { row, kind, children, isDetached };
}

/** The rows as groups: listings in name order, each with its rooms and parts. */
export function buildPropertyTree<T extends TreeRow>(rows: readonly T[]): PropertyNode<T>[] {
  const present = new Set(rows.map((row) => row.id));
  const childrenOf = new Map<number, T[]>();
  for (const row of rows) {
    if (row.parent_id !== null && present.has(row.parent_id)) {
      childrenOf.set(row.parent_id, [...(childrenOf.get(row.parent_id) ?? []), row]);
    }
  }

  return rows
    .filter((row) => row.parent_id === null || !present.has(row.parent_id))
    .sort(byName)
    .map((row) => nodeOf(row, childrenOf, row.parent_id !== null));
}

/** The rows as they are drawn: a closed group shows its listing alone. */
export function visibleRows<T extends TreeRow>(
  tree: readonly PropertyNode<T>[],
  collapsed: ReadonlySet<number>,
  depth = 0,
): VisibleRow<T>[] {
  return tree.flatMap((node) => [
    { node, depth },
    ...(collapsed.has(node.row.id) ? [] : visibleRows(node.children, collapsed, depth + 1)),
  ]);
}
