import { expect } from 'vitest';

import { BOARD_PAGE_CLASS } from './board-viewport';

/**
 * For the boards' pages: the page holding the board (`BOARD_PAGE_CLASS`, the outermost box) lends
 * its height down to the board without a gap — every box from the board up to it takes what is left
 * (`flex-1`), may be less than its content (`min-h-0`), and stands in a column of its parent. One box
 * that does not, and the columns grow the page again instead of scrolling. `page` is the box the
 * test rendered the view in.
 */
export function expectBoardFillsPage(page: HTMLElement): void {
  expect(page.className).toBe(BOARD_PAGE_CLASS);
  const board = page.querySelector<HTMLElement>('[data-board-fill]');
  expect(board).not.toBeNull();
  let box = board as HTMLElement;
  while (box !== page) {
    expect(box).toHaveClass('flex-1', 'min-h-0');
    const parent = box.parentElement as HTMLElement;
    expect(parent).toHaveClass('flex');
    expect(parent.className).toMatch(/(^|\s)flex-col(\s|$)/);
    box = parent;
  }
}
