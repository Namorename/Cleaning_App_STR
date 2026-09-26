import { z } from 'zod';

/**
 * A booking as the calendar draws it (docs/f10-plan.md, §1).
 *
 * `rooms` are the rooms of a multi-unit listing the stay takes; a stay that
 * names none stands on its listing. `is_service_booking` is the server's "#"
 * rule, read as a computed field so the rule stays one function (§2).
 */
export const calendarBookingSchema = z.object({
  id: z.number(),
  property_id: z.number(),
  arrival_date: z.string(),
  departure_date: z.string(),
  status: z.string(),
  is_block: z.boolean(),
  guest_name: z.string().nullable(),
  guests_count: z.number().nullable(),
  check_in_time: z.string().nullable(),
  check_out_time: z.string().nullable(),
  rooms: z.array(z.object({ property_id: z.number() })),
  is_service_booking: z.boolean(),
});

export type CalendarBooking = z.infer<typeof calendarBookingSchema>;

export const calendarBookingListSchema = z.array(calendarBookingSchema);
