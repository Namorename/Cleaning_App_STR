import {
  cartRows,
  catalogLine,
  isZeroQuantity,
  stepQuantity,
  withLine,
  withoutLine,
  withQuantity,
} from '../cart';
import {
  draftItemsPayload,
  emptySupplyDraft,
  type CatalogItem,
  type SupplyDraft,
  type SupplyItemDraft,
} from '../schema';

/**
 * The request as a cart (owner's variant 1): the catalogue is the form, each
 * entry has a stepper, and a line exists only while its quantity is above 0.
 */

const glass: CatalogItem = {
  id: 'c9000002-0000-4000-8000-000000000001',
  name: 'Čistič na sklo',
  name_i18n: { ru: 'Средство для стёкол', en: 'Glass cleaner' },
  unit: 'l',
  sort_order: 1,
};
const bags: CatalogItem = {
  id: 'c9000002-0000-4000-8000-000000000002',
  name: 'Мешки для мусора',
  name_i18n: {},
  unit: 'pack',
  sort_order: 2,
};
const catalog = [glass, bags];

function typed(key: string, name: string, quantity = '1'): SupplyItemDraft {
  return { key, name, quantity, unit: 'pcs', comment: '', catalogItemId: null };
}

function withItems(...items: SupplyItemDraft[]): SupplyDraft {
  return { ...emptySupplyDraft(), items };
}

describe('stepQuantity', () => {
  test('a step is one whole unit up or down', () => {
    expect(stepQuantity('2', 1)).toBe('3');
    expect(stepQuantity('2', -1)).toBe('1');
  });

  test('keeps the decimals she typed, and her comma, without drifting', () => {
    expect(stepQuantity('1,5', 1)).toBe('2,5');
    expect(stepQuantity('2.3', -1)).toBe('1.3');
    expect(stepQuantity('0,25', 1)).toBe('1,25');
  });

  test('down to zero or below is no longer in the request', () => {
    expect(stepQuantity('1', -1)).toBeNull();
    expect(stepQuantity('0,5', -1)).toBeNull();
  });

  test('a quantity that is not a number counts as zero', () => {
    expect(stepQuantity('', 1)).toBe('1');
    expect(stepQuantity('abc', 1)).toBe('1');
    expect(stepQuantity('abc', -1)).toBeNull();
  });
});

describe('isZeroQuantity', () => {
  test('an empty field or a zero means not in the request', () => {
    expect(isZeroQuantity('')).toBe(true);
    expect(isZeroQuantity(' 0 ')).toBe(true);
    expect(isZeroQuantity('0,0')).toBe(true);
  });

  test('anything else stays, to be judged by the same rule as before', () => {
    expect(isZeroQuantity('0,5')).toBe(false);
    expect(isZeroQuantity('abc')).toBe(false);
    expect(isZeroQuantity('-1')).toBe(false);
  });
});

describe('cartRows', () => {
  test('every catalogue entry is a row, in the catalogue’s order, with its line if chosen', () => {
    const line = catalogLine('k1', bags, 'ru', '2');

    const rows = cartRows(withItems(line), catalog, '');

    expect(rows).toEqual([
      { kind: 'entry', entry: glass, line: null },
      { kind: 'entry', entry: bags, line },
    ]);
  });

  test('a line typed by hand stands above the catalogue', () => {
    const own = typed('k1', 'Губки');

    const rows = cartRows(withItems(own), catalog, '');

    expect(rows[0]).toEqual({ kind: 'line', line: own });
    expect(rows).toHaveLength(3);
  });

  test('a line whose entry has left the catalogue stays in view above it', () => {
    const gone = {
      ...typed('k1', 'Старое средство'),
      catalogItemId: 'c9000002-0000-4000-8000-0000000000ff',
    };

    expect(cartRows(withItems(gone), catalog, '')[0]).toEqual({ kind: 'line', line: gone });
  });

  test('a second line of the same entry is not hidden behind the first', () => {
    const first = catalogLine('k1', bags, 'ru', '1');
    const second = { ...catalogLine('k2', bags, 'ru', '3'), comment: 'белые' };

    const rows = cartRows(withItems(first, second), catalog, '');

    expect(rows[0]).toEqual({ kind: 'line', line: second });
    expect(rows).toContainEqual({ kind: 'entry', entry: bags, line: first });
  });

  test('an untouched empty line is not a row', () => {
    expect(cartRows(withItems(typed('k1', '')), catalog, '')).toHaveLength(2);
  });

  test('the search ignores case and diacritics, in any language of the name', () => {
    expect(cartRows(withItems(), catalog, 'CISTIC')).toEqual([
      { kind: 'entry', entry: glass, line: null },
    ]);
    expect(cartRows(withItems(), catalog, 'стекол')).toEqual([
      { kind: 'entry', entry: glass, line: null },
    ]);
    expect(cartRows(withItems(), catalog, 'zzz')).toEqual([]);
  });

  test('the search narrows her own lines too, and a chosen entry keeps its line', () => {
    const own = typed('k1', 'Губки');
    const chosen = catalogLine('k2', glass, 'ru', '2');

    expect(cartRows(withItems(own, chosen), catalog, 'губ')).toEqual([{ kind: 'line', line: own }]);
    expect(cartRows(withItems(own, chosen), catalog, 'glass')).toEqual([
      { kind: 'entry', entry: glass, line: chosen },
    ]);
  });
});

describe('changing the request', () => {
  test('a catalogue line carries the entry’s id, its name as she reads it and its unit', () => {
    expect(catalogLine('k1', glass, 'ru', '1')).toEqual({
      key: 'k1',
      name: 'Средство для стёкол',
      quantity: '1',
      unit: 'l',
      comment: '',
      catalogItemId: glass.id,
    });
  });

  test('lines are added at the end, replaced in place and removed, never mutated', () => {
    const first = typed('k1', 'Губки');
    const draft = withItems(first);

    const added = withLine(draft, typed('k2', 'Перчатки'));
    const renamed = withLine(added, { ...first, name: 'Губки для посуды' });
    const stepped = withQuantity(renamed, 'k2', '3');
    const removed = withoutLine(stepped, 'k1');

    expect(added.items.map((item) => item.name)).toEqual(['Губки', 'Перчатки']);
    expect(renamed.items.map((item) => item.name)).toEqual(['Губки для посуды', 'Перчатки']);
    expect(stepped.items[1].quantity).toBe('3');
    expect(removed.items.map((item) => item.key)).toEqual(['k2']);
    expect(draft.items).toEqual([first]);
  });

  test('what is sent is what was sent before: lines in the order she added them', () => {
    const draft = withLine(withLine(withItems(), catalogLine('k1', bags, 'ru', '1,5')), {
      ...typed('k2', 'Губки', '3'),
      comment: 'жёлтые',
    });

    expect(draftItemsPayload(draft)).toEqual([
      { name: 'Мешки для мусора', quantity: 1.5, unit: 'pack', catalog_item_id: bags.id },
      { name: 'Губки', quantity: 3, unit: 'pcs', comment: 'жёлтые' },
    ]);
  });
});
