import { describe, expect, test } from 'vitest';

import {
  aggregatePurchase,
  canReject,
  isInTab,
  nextStatuses,
  supplyRequestSchema,
  type SupplyRequest,
} from '../schema';

const REQUESTER = '22222222-2222-4222-8222-222222222222';

function request(
  id: string,
  status: SupplyRequest['status'],
  property: string | null,
  items: { name: string; quantity: number | string; unit?: string }[],
): SupplyRequest {
  return supplyRequestSchema.parse({
    id,
    requested_by: REQUESTER,
    property_id: property === null ? null : 1,
    task_id: null,
    status,
    priority: 'normal',
    note: null,
    needed_by: null,
    reviewed_at: null,
    fulfilled_at: null,
    reject_reason: null,
    created_at: '2026-09-09T10:00:00+00:00',
    property: property === null ? null : { name: property },
    requester: { full_name: 'Maria Test' },
    items: items.map((item, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit ?? 'pcs',
      comment: null,
      sort_order: index + 1,
    })),
  });
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';

describe('tabs and moves', () => {
  test('sorts statuses into the tabs; only "all" shows rejected', () => {
    expect(isInTab({ status: 'new' }, 'new')).toBe(true);
    expect(isInTab({ status: 'ordered' }, 'inProgress')).toBe(true);
    expect(isInTab({ status: 'fulfilled' }, 'fulfilled')).toBe(true);
    expect(isInTab({ status: 'rejected' }, 'fulfilled')).toBe(false);
    expect(isInTab({ status: 'rejected' }, 'all')).toBe(true);
  });

  test('offers exactly the moves the server accepts', () => {
    expect(nextStatuses('new')).toEqual(['accepted']);
    expect(nextStatuses('accepted')).toEqual(['ordered', 'fulfilled']);
    expect(nextStatuses('ordered')).toEqual(['fulfilled']);
    expect(nextStatuses('fulfilled')).toEqual([]);
    expect(canReject('ordered')).toBe(true);
    expect(canReject('rejected')).toBe(false);
  });
});

describe('aggregatePurchase', () => {
  test('adds up the same item across requests, ignoring case and spacing, and keeps units apart', () => {
    const lines = aggregatePurchase(
      [
        request(A, 'new', 'Vinohrady 12', [
          { name: 'Мешки 60 л', quantity: '2' },
          { name: 'Средство', quantity: 1, unit: 'l' },
        ]),
        request(B, 'accepted', 'Karlín 3', [
          { name: 'мешки  60 л', quantity: 1.5 },
          { name: 'Средство', quantity: 2, unit: 'pack' },
        ]),
        request(C, 'new', null, [{ name: 'Мешки 60 л', quantity: 0.1 }]),
      ],
      ['new', 'accepted'],
    );

    expect(lines.map((line) => [line.name, line.unit, line.quantity, line.requestCount])).toEqual([
      ['Мешки 60 л', 'pcs', 3.6, 3],
      ['Средство', 'l', 1, 1],
      ['Средство', 'pack', 2, 1],
    ]);
    expect(lines[0]?.sources).toEqual(['Vinohrady 12', 'Karlín 3', null]);
  });

  test('counts a request once however many lines of the same item it holds', () => {
    const lines = aggregatePurchase(
      [
        request(A, 'new', 'Vinohrady 12', [
          { name: 'Мешки 60 л', quantity: 2 },
          { name: 'мешки  60 л', quantity: 1 },
        ]),
      ],
      ['new'],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(3);
    expect(lines[0]?.requestCount).toBe(1);
    expect(lines[0]?.sources).toEqual(['Vinohrady 12']);
  });

  test('counts only the statuses in scope', () => {
    const lines = aggregatePurchase(
      [
        request(A, 'new', 'Vinohrady 12', [{ name: 'Губки', quantity: 5 }]),
        request(B, 'fulfilled', 'Vinohrady 12', [{ name: 'Губки', quantity: 5 }]),
      ],
      ['accepted'],
    );
    expect(lines).toEqual([]);
  });
});
