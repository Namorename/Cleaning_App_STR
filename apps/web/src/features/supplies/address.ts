import { z } from 'zod';

import { EMPTY_DATE_RANGE, SUPPLY_TABS, type DateRange, type SupplyTab } from './schema';

/**
 * What «Заявки» keep in their address (5.4, variant B): the list's tab, its
 * search and dates, and the request open beside it. A link, a bookmark, the
 * sign-in page and «Назад» open the screen as it was left.
 */
export interface SuppliesAddress {
  tab: SupplyTab;
  query: string;
  dates: DateRange;
  /** The request open beside the list; null while none is. */
  request: string | null;
}

export const DEFAULT_SUPPLIES_ADDRESS: SuppliesAddress = {
  tab: 'new',
  query: '',
  dates: EMPTY_DATE_RANGE,
  request: null,
};

/** The names in the query, short: a manager may read and forward the link. */
const PARAM = {
  tab: 'tab',
  query: 'q',
  from: 'from',
  to: 'to',
  request: 'request',
} as const;

const tabSchema = z.enum(SUPPLY_TABS);
const daySchema = z.iso.date();
/** A request's id is minted as a UUID; the database writes it in small letters. */
const requestIdSchema = z.uuid().transform((id) => id.toLowerCase());

/**
 * The address as the screen's state. Each value is checked on its own: an old
 * or hand-edited link loses the part that makes no sense and keeps the rest.
 */
export function readSuppliesAddress(params: URLSearchParams): SuppliesAddress {
  const valid = <T>(schema: z.ZodType<T, unknown>, name: string, fallback: T): T => {
    const parsed = schema.safeParse(params.get(name));
    return parsed.success ? parsed.data : fallback;
  };
  return {
    tab: valid(tabSchema, PARAM.tab, DEFAULT_SUPPLIES_ADDRESS.tab),
    query: params.get(PARAM.query) ?? DEFAULT_SUPPLIES_ADDRESS.query,
    dates: {
      from: valid(daySchema, PARAM.from, EMPTY_DATE_RANGE.from),
      to: valid(daySchema, PARAM.to, EMPTY_DATE_RANGE.to),
    },
    request: valid(requestIdSchema, PARAM.request, DEFAULT_SUPPLIES_ADDRESS.request),
  };
}

/** The query for the state, without its `?`: only what differs from the defaults. */
export function writeSuppliesAddress({ tab, query, dates, request }: SuppliesAddress): string {
  const entries: [string, string][] = [
    [PARAM.tab, tab === DEFAULT_SUPPLIES_ADDRESS.tab ? '' : tab],
    [PARAM.query, query.trim() === '' ? '' : query],
    [PARAM.from, dates.from],
    [PARAM.to, dates.to],
    [PARAM.request, request ?? ''],
  ];
  return new URLSearchParams(entries.filter(([, value]) => value !== '')).toString();
}
