import { MY_CARDS } from './address';

/**
 * A person's own order of the board tabs above «Задания» (owner, 2026-11-26;
 * 20261126160000_board_tab_order): the rules, apart from the screen.
 *
 * A tab is named by an id: 'tech' for the technicians' board, 'mine' for
 * «Назначено мне», a board's uuid for a manager board.
 */
export const TECH_TAB = 'tech';
export const MINE_TAB = MY_CARDS;

/** Which side of the tab under the pointer a dragged tab goes to. */
export type TabSide = 'before' | 'after';

/**
 * The tabs as they stood before anyone chose an order: the technicians' board,
 * «Назначено мне», then the live boards in the order they come (oldest first).
 */
export function defaultTabs(boardIds: readonly string[]): string[] {
  return [TECH_TAB, MINE_TAB, ...boardIds];
}

/**
 * A saved order applied to the tabs the person has now. The tabs it names come
 * first, in its order; a tab it does not name — a board made or shown to her
 * since — comes after them, in the default order; an id that is no tab of hers
 * any more (archived, closed, handed over) is passed over. No order: the
 * default one.
 */
export function applyTabOrder(
  saved: readonly string[] | null | undefined,
  tabs: readonly string[],
): string[] {
  if (saved === null || saved === undefined || saved.length === 0) {
    return [...tabs];
  }
  const have = new Set(tabs);
  const placed = new Set<string>();
  const first: string[] = [];
  for (const id of saved) {
    if (have.has(id) && !placed.has(id)) {
      placed.add(id);
      first.push(id);
    }
  }
  return [...first, ...tabs.filter((id) => !placed.has(id))];
}

/** The order with `moving` put just before or just after `target`. */
export function tabOrderAfterDrop(
  order: readonly string[],
  moving: string,
  target: string,
  side: TabSide,
): string[] {
  if (moving === target || !order.includes(moving) || !order.includes(target)) {
    return [...order];
  }
  const rest = order.filter((id) => id !== moving);
  const at = rest.indexOf(target) + (side === 'after' ? 1 : 0);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** The order with `moving` `step` places back (negative) or on, held inside the row. */
export function moveTabBy(order: readonly string[], moving: string, step: number): string[] {
  const from = order.indexOf(moving);
  if (from < 0) {
    return [...order];
  }
  const to = Math.max(0, Math.min(order.length - 1, from + step));
  const rest = order.filter((id) => id !== moving);
  return [...rest.slice(0, to), moving, ...rest.slice(to)];
}

export function isSameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
