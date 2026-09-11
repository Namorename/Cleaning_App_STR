import { describe, expect, test } from 'vitest';

import { moveAt, removeAt, replaceAt } from '../list';

describe('moving an entry', () => {
  test('swaps it with its neighbour', () => {
    expect(moveAt(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveAt(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  test('a move off either end is simply nothing', () => {
    expect(moveAt(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveAt(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('removing an entry', () => {
  test('takes out the one at that place', () => {
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  test('an index nobody has leaves the list as it was', () => {
    expect(removeAt(['a', 'b'], 7)).toEqual(['a', 'b']);
  });
});

describe('replacing an entry', () => {
  test('puts the new one in that place', () => {
    expect(replaceAt(['a', 'b', 'c'], 1, 'x')).toEqual(['a', 'x', 'c']);
  });

  test('an index nobody has leaves the list as it was', () => {
    expect(replaceAt(['a', 'b'], 7, 'x')).toEqual(['a', 'b']);
  });
});

test('none of them touches the list it was given', () => {
  const list = ['a', 'b'];

  moveAt(list, 0, 1);
  removeAt(list, 0);
  replaceAt(list, 0, 'x');

  expect(list).toEqual(['a', 'b']);
});
