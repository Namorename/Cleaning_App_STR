import { describe, expect, test } from 'vitest';

import {
  applyTabOrder,
  defaultTabs,
  isSameOrder,
  moveTabBy,
  tabOrderAfterDrop,
} from '../tab-order';

const A = 'b0a2d100-0000-4000-8000-00000000000a';
const B = 'b0a2d100-0000-4000-8000-00000000000b';
const C = 'b0a2d100-0000-4000-8000-00000000000c';
const GONE = 'b0a2d100-0000-4000-8000-0000000000ff';

describe('a person’s own order of the board tabs', () => {
  test('without one the tabs stand as before: the two fixed tabs, then the boards', () => {
    expect(defaultTabs([A, B])).toEqual(['tech', 'mine', A, B]);
    expect(applyTabOrder(null, defaultTabs([A, B]))).toEqual(['tech', 'mine', A, B]);
    expect(applyTabOrder([], defaultTabs([A, B]))).toEqual(['tech', 'mine', A, B]);
  });

  test('the tabs it names come in its order', () => {
    expect(applyTabOrder([B, 'mine', A, 'tech'], defaultTabs([A, B]))).toEqual([
      B,
      'mine',
      A,
      'tech',
    ]);
  });

  test('a board it does not name — new, or shown to her since — goes last, in the default order', () => {
    expect(applyTabOrder([B, 'tech'], defaultTabs([A, B, C]))).toEqual([B, 'tech', 'mine', A, C]);
  });

  test('a board she no longer has — archived, closed, handed over — is passed over', () => {
    expect(applyTabOrder([GONE, B, 'tech', GONE], defaultTabs([A, B]))).toEqual([
      B,
      'tech',
      'mine',
      A,
    ]);
  });

  test('a tab named twice stands once, at its first place', () => {
    expect(applyTabOrder([B, 'tech', B], defaultTabs([B]))).toEqual([B, 'tech', 'mine']);
  });

  test('a drop puts the tab before or after the one under the pointer', () => {
    const order = ['tech', 'mine', A, B];
    expect(tabOrderAfterDrop(order, B, 'tech', 'before')).toEqual([B, 'tech', 'mine', A]);
    expect(tabOrderAfterDrop(order, 'tech', A, 'after')).toEqual(['mine', A, 'tech', B]);
    expect(tabOrderAfterDrop(order, 'tech', 'mine', 'before')).toEqual(order);
    expect(tabOrderAfterDrop(order, A, A, 'after')).toEqual(order);
    expect(tabOrderAfterDrop(order, GONE, A, 'after')).toEqual(order);
  });

  test('the keyboard moves a tab a place at a time, never out of the row', () => {
    const order = ['tech', 'mine', A];
    expect(moveTabBy(order, A, -1)).toEqual(['tech', A, 'mine']);
    expect(moveTabBy(order, 'tech', -1)).toEqual(order);
    expect(moveTabBy(order, 'tech', 99)).toEqual(['mine', A, 'tech']);
    expect(moveTabBy(order, GONE, 1)).toEqual(order);
  });

  test('two orders are the same only tab for tab', () => {
    expect(isSameOrder(['tech', A], ['tech', A])).toBe(true);
    expect(isSameOrder(['tech', A], [A, 'tech'])).toBe(false);
    expect(isSameOrder(['tech'], ['tech', A])).toBe(false);
  });
});
