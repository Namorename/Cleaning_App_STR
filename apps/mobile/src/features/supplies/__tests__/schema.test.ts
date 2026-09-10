import {
  canEditSupplyRequest,
  catalogItemName,
  clearCatalogPick,
  draftItemsPayload,
  draftOfRequest,
  emptySupplyDraft,
  filterCatalog,
  newItemDraft,
  pickCatalogItem,
  groupSupplyRequests,
  parseQuantity,
  supplyDraftIssue,
  supplyRequestSchema,
  type SupplyDraft,
  type SupplyRequest,
} from '../schema';

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function request(overrides: Partial<SupplyRequest> = {}): SupplyRequest {
  return {
    id: 'c9000001-0000-4000-8000-000000000001',
    requested_by: ME,
    property_id: null,
    task_id: null,
    status: 'new',
    priority: 'normal',
    note: null,
    needed_by: null,
    reviewed_at: null,
    fulfilled_at: null,
    reject_reason: null,
    created_at: '2026-11-10T08:05:00+00:00',
    property: null,
    items: [
      {
        id: 'e9000001-0000-4000-8000-000000000002',
        name: 'Мешки',
        quantity: 1,
        unit: 'pack',
        comment: '60 л',
        sort_order: 2,
        catalog_item_id: null,
      },
      {
        id: 'e9000001-0000-4000-8000-000000000001',
        name: 'Средство для стёкол',
        quantity: 2.5,
        unit: 'l',
        comment: null,
        sort_order: 1,
        catalog_item_id: null,
      },
    ],
    ...overrides,
  };
}

function draft(overrides: Partial<SupplyDraft> = {}): SupplyDraft {
  return { ...emptySupplyDraft('k1'), ...overrides };
}

describe('parseQuantity', () => {
  test('reads a decimal comma the way a phone keyboard types it', () => {
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity(' 2 ')).toBe(2);
  });

  test('refuses zero, negatives and words', () => {
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('two')).toBeNull();
  });
});

describe('supplyDraftIssue', () => {
  test('an untouched form has no items yet', () => {
    expect(supplyDraftIssue(draft())).toBe('itemsRequired');
  });

  test('a filled line with a bad quantity is named', () => {
    const bad = draft({
      items: [{ key: 'k1', name: 'Мешки', quantity: '0', unit: 'pack', comment: '', catalogItemId: null }],
    });

    expect(supplyDraftIssue(bad)).toBe('itemInvalid');
  });

  test('a filled line with a quantity is enough', () => {
    const ok = draft({
      items: [{ key: 'k1', name: 'Мешки', quantity: '2', unit: 'pack', comment: '', catalogItemId: null }],
    });

    expect(supplyDraftIssue(ok)).toBeNull();
  });
});

describe('draftItemsPayload', () => {
  test('sends filled lines in order, trimmed, with the comment only when there is one', () => {
    const payload = draftItemsPayload(
      draft({
        items: [
          { key: 'a', name: ' Мешки ', quantity: '1,5', unit: 'pack', comment: ' 60 л ', catalogItemId: null },
          { key: 'b', name: '', quantity: '1', unit: 'pcs', comment: '', catalogItemId: null },
          { key: 'c', name: 'Перчатки', quantity: '3', unit: 'pcs', comment: '', catalogItemId: null },
        ],
      }),
    );

    expect(payload).toEqual([
      { name: 'Мешки', quantity: 1.5, unit: 'pack', comment: '60 л' },
      { name: 'Перчатки', quantity: 3, unit: 'pcs' },
    ]);
  });
});

describe('draftOfRequest', () => {
  test('rebuilds the lines in their saved order', () => {
    const rebuilt = draftOfRequest(request());

    expect(rebuilt.items.map((item) => item.name)).toEqual(['Средство для стёкол', 'Мешки']);
    expect(rebuilt.items[0].quantity).toBe('2.5');
    expect(rebuilt.items[1].comment).toBe('60 л');
  });
});

describe('canEditSupplyRequest', () => {
  test('the author edits while the request is new, and only then', () => {
    expect(canEditSupplyRequest(request(), ME)).toBe(true);
    expect(canEditSupplyRequest(request({ status: 'accepted' }), ME)).toBe(false);
    expect(canEditSupplyRequest(request(), 'a1b2c3d4-2222-4222-8222-a1b2c3d40002')).toBe(false);
  });
});

describe('groupSupplyRequests', () => {
  test('keeps live requests above fulfilled and rejected ones', () => {
    const groups = groupSupplyRequests([
      request({
        id: 'c9000001-0000-4000-8000-000000000002',
        status: 'rejected',
        reject_reason: 'x',
      }),
      request(),
      request({ id: 'c9000001-0000-4000-8000-000000000003', status: 'ordered' }),
    ]);

    expect(groups.map((group) => [group.key, group.data.length])).toEqual([
      ['active', 2],
      ['closed', 1],
    ]);
  });
});

describe('supplyRequestSchema', () => {
  test('reads the numeric quantity the wire sends as text', () => {
    const { items, ...bare } = request();
    const parsed = supplyRequestSchema.parse({
      ...bare,
      items: items.map((item) => ({ ...item, quantity: '2.50' })),
    });

    expect(parsed.items[0].quantity).toBe(2.5);
  });

  test('a row straight from an RPC has no items yet', () => {
    const { items, property, ...bare } = request();
    void items;
    void property;

    expect(supplyRequestSchema.parse(bare).items).toEqual([]);
  });
});

describe('the catalogue', () => {
  const entry = {
    id: 'c9000002-0000-4000-8000-000000000001',
    name: 'Средство для стёкол',
    name_i18n: { en: 'Glass cleaner' },
    unit: 'l' as const,
    sort_order: 1,
  };

  test('names an entry in her language and falls back to the manager’s words', () => {
    expect(catalogItemName(entry, 'en')).toBe('Glass cleaner');
    expect(catalogItemName(entry, 'cs')).toBe('Средство для стёкол');
    expect(catalogItemName({ ...entry, name_i18n: { en: '  ' } }, 'en')).toBe('Средство для стёкол');
  });

  test('a picked line takes the name and unit from the entry, and can be cleared again', () => {
    const line = newItemDraft('k1');
    const picked = pickCatalogItem(line, entry, 'en');

    expect(picked).toEqual({
      ...line,
      name: 'Glass cleaner',
      unit: 'l',
      catalogItemId: entry.id,
    });
    expect(clearCatalogPick(picked)).toEqual({ ...picked, name: '', catalogItemId: null });
  });

  test('a picked line needs no typed name and travels with its entry id', () => {
    const line = { ...newItemDraft('k1'), quantity: '2', catalogItemId: entry.id };

    expect(supplyDraftIssue(draft({ items: [line] }))).toBeNull();
    expect(draftItemsPayload(draft({ items: [line] }))).toEqual([
      { name: '', quantity: 2, unit: 'pcs', catalog_item_id: entry.id },
    ]);
  });

  test('a rebuilt line remembers where it came from', () => {
    const { items, ...bare } = request();
    const rebuilt = draftOfRequest({
      ...bare,
      items: [{ ...items[1], catalog_item_id: entry.id }],
    });

    expect(rebuilt.items[0].catalogItemId).toBe(entry.id);
  });

  test('the search matches any language, ignoring case', () => {
    const bags = { ...entry, id: 'c9000002-0000-4000-8000-000000000002', name: 'Мешки', name_i18n: {} };

    expect(filterCatalog([entry, bags], 'GLASS').map((item) => item.name)).toEqual(['Средство для стёкол']);
    expect(filterCatalog([entry, bags], 'меш').map((item) => item.name)).toEqual(['Мешки']);
    expect(filterCatalog([entry, bags], '  ')).toHaveLength(2);
  });
});
