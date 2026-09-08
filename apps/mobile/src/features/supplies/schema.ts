import { z } from 'zod';

export const SUPPLY_UNITS = ['pcs', 'pack', 'l', 'kg', 'roll'] as const;
export type SupplyUnit = (typeof SUPPLY_UNITS)[number];

export const SUPPLY_PRIORITIES = ['normal', 'urgent'] as const;
export type SupplyPriority = (typeof SUPPLY_PRIORITIES)[number];

export const SUPPLY_STATUSES = ['new', 'accepted', 'ordered', 'fulfilled', 'rejected'] as const;
export type SupplyStatus = (typeof SUPPLY_STATUSES)[number];

/** The same numbers the database checks. */
export const MAX_SUPPLY_NOTE = 2000;
export const MAX_SUPPLY_ITEM_NAME = 120;
export const MAX_SUPPLY_ITEM_COMMENT = 300;

export const supplyItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // numeric travels as a string over the wire.
  quantity: z.coerce.number(),
  unit: z.enum(SUPPLY_UNITS),
  comment: z.string().nullable(),
  sort_order: z.number(),
});

export type SupplyItem = z.infer<typeof supplyItemSchema>;

/**
 * A request as the app reads it. Items and the listing name come from
 * joins; a row straight from an RPC has neither, so both have fallbacks.
 */
export const supplyRequestSchema = z.object({
  id: z.string().uuid(),
  requested_by: z.string().uuid(),
  property_id: z.number().nullable(),
  task_id: z.string().uuid().nullable(),
  status: z.enum(SUPPLY_STATUSES),
  priority: z.enum(SUPPLY_PRIORITIES),
  note: z.string().nullable(),
  needed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  fulfilled_at: z.string().nullable(),
  reject_reason: z.string().nullable(),
  created_at: z.string(),
  property: z.object({ name: z.string().nullable() }).nullable().optional(),
  items: z.array(supplyItemSchema).default([]),
});

export type SupplyRequest = z.infer<typeof supplyRequestSchema>;
export const supplyRequestListSchema = z.array(supplyRequestSchema);

/** One line of the form. Quantity stays text until it is sent: "1,5" is typed, not parsed. */
export interface SupplyItemDraft {
  key: string;
  name: string;
  quantity: string;
  unit: SupplyUnit;
  comment: string;
}

export interface SupplyDraft {
  items: SupplyItemDraft[];
  priority: SupplyPriority;
  note: string;
}

export function newItemDraft(key: string): SupplyItemDraft {
  return { key, name: '', quantity: '1', unit: 'pcs', comment: '' };
}

export function emptySupplyDraft(firstKey: string): SupplyDraft {
  return { items: [newItemDraft(firstKey)], priority: 'normal', note: '' };
}

/** "1,5" and "1.5" both mean one and a half. Anything else is not a number. */
export function parseQuantity(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Lines the cleaner actually filled in; an untouched empty line is not an error. */
export function filledItems(draft: SupplyDraft): SupplyItemDraft[] {
  return draft.items.filter((item) => item.name.trim() !== '' || item.comment.trim() !== '');
}

export type SupplyDraftIssue = 'itemsRequired' | 'itemInvalid' | 'noteTooLong';

/** Why the draft cannot be sent yet, mirroring the server's refusals, or null. */
export function supplyDraftIssue(draft: SupplyDraft): SupplyDraftIssue | null {
  const items = filledItems(draft);
  if (items.length === 0) {
    return 'itemsRequired';
  }
  const bad = items.some(
    (item) =>
      item.name.trim() === '' ||
      item.name.trim().length > MAX_SUPPLY_ITEM_NAME ||
      parseQuantity(item.quantity) === null ||
      item.comment.length > MAX_SUPPLY_ITEM_COMMENT,
  );
  if (bad) {
    return 'itemInvalid';
  }
  if (draft.note.length > MAX_SUPPLY_NOTE) {
    return 'noteTooLong';
  }
  return null;
}

export interface SupplyItemPayload {
  name: string;
  quantity: number;
  unit: SupplyUnit;
  comment?: string;
}

/** The lines as the server takes them, in the order entered. */
export function draftItemsPayload(draft: SupplyDraft): SupplyItemPayload[] {
  return filledItems(draft).map((item) => ({
    name: item.name.trim(),
    quantity: parseQuantity(item.quantity) ?? 0,
    unit: item.unit,
    ...(item.comment.trim() === '' ? {} : { comment: item.comment.trim() }),
  }));
}

export function draftOfRequest(request: SupplyRequest): SupplyDraft {
  return {
    items: request.items
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        key: item.id,
        name: item.name,
        quantity: String(item.quantity),
        unit: item.unit,
        comment: item.comment ?? '',
      })),
    priority: request.priority,
    note: request.note ?? '',
  };
}

/** The author may change or withdraw a request until a manager picks it up. */
export function canEditSupplyRequest(request: SupplyRequest, userId: string | null): boolean {
  return request.status === 'new' && request.requested_by === userId;
}

export function isSupplyRequestClosed(request: SupplyRequest): boolean {
  return request.status === 'fulfilled' || request.status === 'rejected';
}

export interface SupplyGroup {
  key: 'active' | 'closed';
  data: SupplyRequest[];
}

export function groupSupplyRequests(requests: readonly SupplyRequest[]): SupplyGroup[] {
  const active = requests.filter((request) => !isSupplyRequestClosed(request));
  const closed = requests.filter(isSupplyRequestClosed);

  return [
    ...(active.length > 0 ? [{ key: 'active' as const, data: active }] : []),
    ...(closed.length > 0 ? [{ key: 'closed' as const, data: closed }] : []),
  ];
}
