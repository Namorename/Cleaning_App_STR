import { PROPERTY_PATH_SEPARATOR, propertyPathOf, splitPlace } from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

/**
 * The one place that decides which half of a name is the house.
 *
 * Eight screens across two apps ask this question, and until they all came
 * here each carried its own copy. The copies are the danger: a room's name
 * ("1 - 2109") names a door and no house, and a screen that forgets to prefix
 * it shows a manager something she cannot place — while a screen that spells
 * the separator by hand silently stops the panel's search finding the phone's
 * reports, because the two haystacks stop matching.
 */
describe('splitPlace', () => {
  test('a room is the house, then itself', () => {
    expect(
      splitPlace({ name: '1 - 2109', hostaway_unit_id: 64266, parent: { name: 'Vinohradska Royal' } }),
    ).toEqual({ building: 'Vinohradska Royal', room: '1 - 2109' });
  });

  // `parent_id` carries two relations. A part of a combined listing is a real
  // listing with its own calendar and its own guests; naming it after its
  // neighbour would put the wrong address on the row.
  test('a part of a combined listing keeps its own name', () => {
    expect(
      splitPlace({ name: 'Andel 4 - half', hostaway_unit_id: null, parent: { name: 'Andel 4 - whole' } }),
    ).toEqual({ building: 'Andel 4 - half', room: null });
  });

  test('an ordinary listing is itself and nothing above it', () => {
    expect(splitPlace({ name: 'Brehova 208', hostaway_unit_id: null, parent: null })).toEqual({
      building: 'Brehova 208',
      room: null,
    });
  });

  // Should not happen — the status cascade takes rooms with their listing —
  // but an incomplete name beats a blank field on every row standing on it.
  test('a room whose house did not come along keeps its own name', () => {
    expect(splitPlace({ name: '1 - 2109', hostaway_unit_id: 64266, parent: null })).toEqual({
      building: '1 - 2109',
      room: null,
    });
  });

  // The phone restores rows from disk through JSON.parse, so a row written by
  // an older build arrives with the keys that build knew and no others. Zod
  // fills defaults coming in from the network; nothing fills them from disk.
  test('a row restored from an older build, with neither key, still names itself', () => {
    expect(splitPlace({ name: 'Brehova 208' })).toEqual({ building: 'Brehova 208', room: null });
  });
});

describe('propertyPathOf', () => {
  test('joins the two halves with the separator both apps share', () => {
    expect(
      propertyPathOf({ name: '1 - 2109', hostaway_unit_id: 64266, parent: { name: 'Vinohradska Royal' } }),
    ).toBe(`Vinohradska Royal${PROPERTY_PATH_SEPARATOR}1 - 2109`);
  });

  // An em dash with spaces, not a hyphen: room names are already full of
  // hyphens, and a second one would blur where the house ends.
  test('and the separator is the em dash, spelled out', () => {
    expect(PROPERTY_PATH_SEPARATOR).toBe(' — ');
  });

  test('nothing joined is null, so the caller decides what to show instead', () => {
    expect(propertyPathOf(null)).toBeNull();
    expect(propertyPathOf(undefined)).toBeNull();
  });
});
