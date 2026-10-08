import { matchesAllTokens } from '@str-ops/shared';

import {
  filledItems,
  filterCatalog,
  newItemDraft,
  parseQuantity,
  pickCatalogItem,
  type CatalogItem,
  type SupplyDraft,
  type SupplyItemDraft,
} from './schema';

/**
 * The request as a cart (owner's variant 1, docs/design/decisions.md §2): the
 * catalogue is the form, every entry carries a stepper, and a line exists only
 * while its quantity is above zero. What is sent does not change — the same
 * draft, the same `draftItemsPayload`: the lines in the order she added them.
 */

/** A row of the form's list. */
export type CartRow =
  /** A line no catalogue row stands for: typed by hand, or its entry gone from the list. */
  | { kind: 'line'; line: SupplyItemDraft }
  /** A catalogue entry, with its line when it is in the request. */
  | { kind: 'entry'; entry: CatalogItem; line: SupplyItemDraft | null };

/**
 * The list, top to bottom: her own lines, then the catalogue in its order.
 *
 * An entry stands for the first line picked from it. A second line of the same
 * entry — the old form let her pick one twice, say with two different
 * comments — joins her own lines rather than vanish from the screen while it
 * is still sent. The search narrows both.
 */
export function cartRows(
  draft: SupplyDraft,
  catalog: readonly CatalogItem[],
  query: string,
): CartRow[] {
  const lines = filledItems(draft);
  const lineOf = new Map<string, SupplyItemDraft>();
  for (const entry of catalog) {
    const line = lines.find((item) => item.catalogItemId === entry.id);
    if (line !== undefined) {
      lineOf.set(entry.id, line);
    }
  }
  const claimed = new Set([...lineOf.values()].map((line) => line.key));

  const own: CartRow[] = lines
    .filter((line) => !claimed.has(line.key) && matchesAllTokens(line.name, query))
    .map((line) => ({ kind: 'line', line }));
  const entries: CartRow[] = filterCatalog(catalog, query).map((entry) => ({
    kind: 'entry',
    entry,
    line: lineOf.get(entry.id) ?? null,
  }));
  return [...own, ...entries];
}

/** A new line picked from the catalogue: the entry's name as she reads it and its unit. */
export function catalogLine(
  key: string,
  entry: CatalogItem,
  language: string,
  quantity: string,
): SupplyItemDraft {
  return pickCatalogItem({ ...newItemDraft(key), quantity }, entry, language);
}

/** Digits after the decimal separator; a step keeps the precision she typed. */
function decimalsOf(text: string): number {
  const [, fraction = ''] = text.trim().split(/[.,]/);
  return /^\d+$/.test(fraction) ? fraction.length : 0;
}

/**
 * The quantity one step up or down, written the way she wrote it — her comma,
 * her decimals, no binary drift ("2,3" − 1 is "1,3", not 1.2999…). Null when
 * it falls to zero or below: the line leaves the request. A quantity that is
 * not a number counts as zero.
 */
export function stepQuantity(text: string, delta: 1 | -1): string | null {
  const next = (parseQuantity(text) ?? 0) + delta;
  if (next <= 0) {
    return null;
  }
  const written = String(Number(next.toFixed(decimalsOf(text))));
  return text.includes(',') ? written.replace('.', ',') : written;
}

/**
 * An empty field or a zero: not in the request. Anything else stays as typed,
 * to be held to the rule it always was (`isLineValid`) — "abc" is not taken
 * for a zero.
 */
export function isZeroQuantity(text: string): boolean {
  return Number(text.trim().replace(',', '.')) === 0;
}

/** The draft with the line put in place of its namesake, or added at the end. */
export function withLine(draft: SupplyDraft, line: SupplyItemDraft): SupplyDraft {
  const isThere = draft.items.some((item) => item.key === line.key);
  return {
    ...draft,
    items: isThere
      ? draft.items.map((item) => (item.key === line.key ? line : item))
      : [...draft.items, line],
  };
}

export function withQuantity(draft: SupplyDraft, key: string, quantity: string): SupplyDraft {
  return {
    ...draft,
    items: draft.items.map((item) => (item.key === key ? { ...item, quantity } : item)),
  };
}

export function withoutLine(draft: SupplyDraft, key: string): SupplyDraft {
  return { ...draft, items: draft.items.filter((item) => item.key !== key) };
}
