import { describe, expect, test } from 'vitest';

import { buildPropertyTree, visibleRows, type TreeRow } from '../property-tree';

const row = (id: number, name: string, parent: number | null = null, unit: number | null = null) =>
  ({ id, name, parent_id: parent, hostaway_unit_id: unit }) satisfies TreeRow;

/**
 * One tree for the registry and the calendar (docs/f10-plan.md, §3).
 *
 * `parent_id` carries two relationships and `hostaway_unit_id` tells them apart:
 * a room of a multi-unit listing has one, a part of a combined listing (a villa)
 * does not — it is a listing of its own with its own bookings.
 */
describe('buildPropertyTree', () => {
  test('an ordinary listing is a row of its own', () => {
    const [node] = buildPropertyTree([row(1, 'Anglicka 7')]);

    expect(node.kind).toBe('listing');
    expect(node.children).toEqual([]);
    expect(node.isDetached).toBe(false);
  });

  test('a multi-unit listing holds its rooms, counted the way a person counts', () => {
    const tree = buildPropertyTree([
      row(10, 'Royal Cerna'),
      row(12, 'Unit 10', 10, 7010),
      row(11, 'Unit 3', 10, 7003),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('multiUnit');
    expect(tree[0].children.map((child) => child.row.name)).toEqual(['Unit 3', 'Unit 10']);
    expect(tree[0].children.map((child) => child.kind)).toEqual(['room', 'room']);
  });

  test('a villa holds its parts, which are listings of their own', () => {
    const [villa] = buildPropertyTree([
      row(20, 'Villa Whole'),
      row(21, 'Villa East', 20),
      row(22, 'Villa West', 20),
    ]);

    expect(villa.kind).toBe('villa');
    expect(villa.children.map((child) => child.kind)).toEqual(['part', 'part']);
  });

  test('a villa with rooms keeps both, rooms first', () => {
    const [villa] = buildPropertyTree([
      row(30, 'Big House'),
      row(31, 'Annex', 30),
      row(32, 'Room 2', 30, 3002),
      row(33, 'Room 1', 30, 3001),
    ]);

    expect(villa.kind).toBe('villa');
    expect(villa.children.map((child) => child.row.name)).toEqual(['Room 1', 'Room 2', 'Annex']);
    expect(villa.children.map((child) => child.kind)).toEqual(['room', 'room', 'part']);
  });

  test('the listings go by name, numbers counted as numbers', () => {
    const tree = buildPropertyTree([row(3, 'Listing 10'), row(1, 'listing 2'), row(2, 'Anděl')]);

    expect(tree.map((node) => node.row.name)).toEqual(['Anděl', 'listing 2', 'Listing 10']);
  });

  // The registry shows a room in the tab of its own status; when its listing is
  // in another tab, the room stands alone there (docs/f10-plan.md, 7.1, trap 3).
  test('a room whose listing is not among the rows stands alone and says so', () => {
    const [node] = buildPropertyTree([row(41, 'Unit 1', 40, 4001)]);

    expect(node.kind).toBe('room');
    expect(node.isDetached).toBe(true);
    expect(node.children).toEqual([]);
  });

  test('leaves the rows it was given as they were', () => {
    const rows = [row(2, 'B'), row(1, 'A')];

    buildPropertyTree(rows);

    expect(rows.map((one) => one.id)).toEqual([2, 1]);
  });
});

describe('visibleRows', () => {
  const tree = buildPropertyTree([
    row(10, 'Royal Cerna'),
    row(11, 'Unit 1', 10, 7001),
    row(12, 'Unit 2', 10, 7002),
    row(1, 'Anglicka 7'),
  ]);

  test('an open group shows its rooms one level in', () => {
    expect(visibleRows(tree, new Set()).map((one) => [one.node.row.name, one.depth])).toEqual([
      ['Anglicka 7', 0],
      ['Royal Cerna', 0],
      ['Unit 1', 1],
      ['Unit 2', 1],
    ]);
  });

  test('a closed group shows the listing alone', () => {
    expect(visibleRows(tree, new Set([10])).map((one) => one.node.row.name)).toEqual([
      'Anglicka 7',
      'Royal Cerna',
    ]);
  });
});
