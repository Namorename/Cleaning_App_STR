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
  expectNothingEscapesTheScrollers(board as HTMLElement);
}

const SCROLLER = /(^|\s)overflow(-[xy])?-(auto|scroll|hidden|clip)(\s|$)/;
const PLACED = /(^|\s)(relative|absolute|fixed|sticky)(\s|$)/;
const PLACED_OUT = /(^|\s)(sr-only|absolute)(\s|$)/;

/**
 * Nothing placed absolutely inside a board — a screen-reader label (`sr-only`) is — may hang on a
 * box outside the column or frame that scrolls it: its containing block would be the page, the
 * scroller would not clip it, and the page would grow by its offset however tall the window is
 * (the day dividers of 2026-11-27 lengthened the page by thousands of pixels). Every such box needs
 * a positioned box between itself and its nearest scroller, or the scroller itself positioned.
 */
export function expectNothingEscapesTheScrollers(board: HTMLElement): void {
  const escaping = [...board.querySelectorAll<HTMLElement>('*')]
    .filter((element) => PLACED_OUT.test(element.className))
    .filter((element) => {
      for (let up = element.parentElement; up !== null; up = up.parentElement) {
        if (PLACED.test(up.className)) {
          return false;
        }
        if (SCROLLER.test(up.className) || up === board) {
          return true;
        }
      }
      return true;
    })
    .map((element) => element.textContent);
  expect(escaping).toEqual([]);
}
