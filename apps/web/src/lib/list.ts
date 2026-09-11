/**
 * Immutable edits to an ordered list.
 *
 * Both editors in the panel — the checklist of a flat and the process of a
 * company — are lists whose order is their meaning: the server writes
 * `sort_order` from the position in the array, and whoever reads the list
 * reads it top to bottom. The arrows are the field, not decoration, so the
 * moving lives in one place rather than once per editor.
 */

/** The list without the entry at `index`. Out of range returns it unchanged. */
export function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, at) => at !== index);
}

/**
 * Move one entry up or down.
 *
 * A move off either end is not an error, it is simply nothing: the button at
 * the top of the list stays pressable and does nothing, which is easier to
 * read than a button that disappears.
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

/** The list with the entry at `index` replaced. Out of range returns it unchanged. */
export function replaceAt<T>(list: T[], index: number, next: T): T[] {
  return list.map((entry, at) => (at === index ? next : entry));
}
