import {
  canEditSupplyRequest,
  draftItemsPayload,
  draftOfRequest,
  emptySupplyDraft,
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
      },
      {
        id: 'e9000001-0000-4000-8000-000000000001',
        name: 'Средство для стёкол',
        quantity: 2.5,
        unit: 'l',
        comment: null,
        sort_order: 1,
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
      items: [{ key: 'k1', name: 'Мешки', quantity: '0', unit: 'pack', comment: '' }],
    });

    expect(supplyDraftIssue(bad)).toBe('itemInvalid');
  });

  test('a filled line with a quantity is enough', () => {
    const ok = draft({
      items: [{ key: 'k1', name: 'Мешки', quantity: '2', unit: 'pack', comment: '' }],
    });

    expect(supplyDraftIssue(ok)).toBeNull();
  });
});

describe('draftItemsPayload', () => {
  test('sends filled lines in order, trimmed, with the comment only when there is one', () => {
    const payload = draftItemsPayload(
      draft({
        items: [
          { key: 'a', name: ' Мешки ', quantity: '1,5', unit: 'pack', comment: ' 60 л ' },
          { key: 'b', name: '', quantity: '1', unit: 'pcs', comment: '' },
          { key: 'c', name: 'Перчатки', quantity: '3', unit: 'pcs', comment: '' },
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
