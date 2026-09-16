import { filterProperties, propertyLabel, type ReportProperty } from '../schema';

/**
 * A room is named after the house it stands in, and the test for "room" is the
 * unit id — never the parent link alone. `parent_id` also joins the two halves
 * of a combined listing, and a half is a listing of its own: naming it after
 * its neighbour would put the wrong address on a report.
 */

const house: ReportProperty = {
  id: 412432,
  name: 'CZ - Vinohradska Royal',
  parent_id: null,
  hostaway_unit_id: null,
  parent_name: null,
};

const room: ReportProperty = {
  id: 1000000064266,
  name: '1 - 2109',
  parent_id: 412432,
  hostaway_unit_id: '64266',
  parent_name: 'CZ - Vinohradska Royal',
};

const combinedHalf: ReportProperty = {
  id: 500001,
  name: 'Andel 4 - half',
  parent_id: 500000,
  hostaway_unit_id: null,
  parent_name: 'Andel 4 - whole',
};

test('a house is called by its own name', () => {
  expect(propertyLabel(house)).toBe('CZ - Vinohradska Royal');
});

test('a room is called by the house and then itself', () => {
  expect(propertyLabel(room)).toBe('CZ - Vinohradska Royal — 1 - 2109');
});

test('a part of a combined listing keeps its own name, parent or no parent', () => {
  expect(propertyLabel(combinedHalf)).toBe('Andel 4 - half');
});

test('an empty query leaves the list as it is', () => {
  expect(filterProperties([house, room], '  ')).toEqual([house, room]);
});

test('the words may be typed in any order, as the panel search allows', () => {
  expect(filterProperties([house, room], '2109 vinohradska')).toEqual([room]);
});

test('a house matches its own name without dragging its rooms along', () => {
  expect(filterProperties([house, room], 'royal 1 - 2109')).toEqual([room]);
});

test('nothing matching is an empty list, not everything', () => {
  expect(filterProperties([house, room], 'nadrazni')).toEqual([]);
});
