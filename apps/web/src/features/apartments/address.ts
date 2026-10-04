import { z } from 'zod';

import { APARTMENT_TABS, type ApartmentTab } from './schema';

/** The sections of a listing's card, in the order the plan builds them. */
export const CARD_TABS = ['info', 'cleaners', 'checklist', 'bookings', 'maintenance'] as const;
export type CardTab = (typeof CARD_TABS)[number];

/**
 * What «Объекты» keep in their address (5.4, variant B): the registry's status
 * tab and search, the listing open beside it and the tab of its card. A link,
 * a bookmark, the sign-in page and «Назад» open the screen as it was left.
 */
export interface ApartmentsAddress {
  status: ApartmentTab;
  query: string;
  /** The listing whose card is open; null while none is. */
  listing: number | null;
  card: CardTab;
}

export const DEFAULT_APARTMENTS_ADDRESS: ApartmentsAddress = {
  status: 'active',
  query: '',
  listing: null,
  card: 'info',
};

/** The names in the query, short: a manager may read and forward the link. */
const PARAM = { status: 'status', query: 'q', listing: 'listing', card: 'card' } as const;

const statusSchema = z.enum(APARTMENT_TABS);
const cardSchema = z.enum(CARD_TABS);
/** Listing ids come from Hostaway and are whole numbers. */
const listingSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive());

/**
 * The address as the screen's state. Each value is checked on its own: an old
 * or hand-edited link loses the part that makes no sense and keeps the rest.
 */
export function readApartmentsAddress(params: URLSearchParams): ApartmentsAddress {
  const valid = <T>(schema: z.ZodType<T, unknown>, name: string, fallback: T): T => {
    const parsed = schema.safeParse(params.get(name));
    return parsed.success ? parsed.data : fallback;
  };
  return {
    status: valid(statusSchema, PARAM.status, DEFAULT_APARTMENTS_ADDRESS.status),
    query: params.get(PARAM.query) ?? DEFAULT_APARTMENTS_ADDRESS.query,
    listing: valid(listingSchema, PARAM.listing, DEFAULT_APARTMENTS_ADDRESS.listing),
    card: valid(cardSchema, PARAM.card, DEFAULT_APARTMENTS_ADDRESS.card),
  };
}

/** The query for the state, without its `?`: only what differs from the defaults. */
export function writeApartmentsAddress(address: ApartmentsAddress): string {
  const entries: [string, string][] = [
    [PARAM.status, address.status === DEFAULT_APARTMENTS_ADDRESS.status ? '' : address.status],
    [PARAM.query, address.query.trim() === '' ? '' : address.query],
    [PARAM.listing, address.listing === null ? '' : String(address.listing)],
    [PARAM.card, address.card === DEFAULT_APARTMENTS_ADDRESS.card ? '' : address.card],
  ];
  return new URLSearchParams(entries.filter(([, value]) => value !== '')).toString();
}
