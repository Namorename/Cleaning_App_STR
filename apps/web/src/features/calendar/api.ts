import { fetchAllPages } from '@/lib/fetch-all-pages';
import type { Client } from '@/lib/supabase/use-client';

import { calendarBookingListSchema, type CalendarBooking } from './schema';

/**
 * The statuses drawn as bars: a guest (`new`, `modified`) or a block
 * (`ownerStay`). Cancelled stays, inquiries and Hostaway's expired are left
 * out — with them one night carries up to six bars, without them two
 * (docs/f10-plan.md, §2).
 */
export const LIVE_BOOKING_STATUSES = ['new', 'modified', 'ownerStay'] as const;

// The listing is not embedded: `property_id` is enough, and the embed of
// `reservation_units` is the one relationship this read has to name.
const BOOKING_COLUMNS =
  'id, property_id, arrival_date, departure_date, status, is_block, guest_name, guests_count, ' +
  'check_in_time, check_out_time, rooms:reservation_units(property_id), is_service_booking';

/**
 * The live stays that touch the days `from` up to `to` (exclusive): they
 * arrive before `to` and leave on or after `from` — a departure on `from` is
 * half a cell of that day. Read in pages, sorted to the id last.
 */
export async function fetchCalendarBookings(
  client: Client,
  from: string,
  to: string,
): Promise<CalendarBooking[]> {
  const rows = await fetchAllPages((first, last, withCount) =>
    client
      .from('reservations')
      .select(BOOKING_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .lt('arrival_date', to)
      .gte('departure_date', from)
      .in('status', [...LIVE_BOOKING_STATUSES])
      .order('arrival_date', { ascending: true })
      .order('id', { ascending: true })
      .range(first, last),
  );
  return calendarBookingListSchema.parse(rows);
}
