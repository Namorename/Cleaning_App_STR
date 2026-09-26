import { addDays, daysBetween } from './dates';

/**
 * Tasks and staff of the calendar stand (docs/f10-plan.md, §5, 7.4).
 *
 * A cleaning on every guest departure, where the generator would put it: on
 * each room a stay names, else on its listing; none for a block or the
 * office's own "#" booking; SDT when the next guest arrives the same day into
 * the same row. Past cleanings are done, today's and later ones open or in
 * work. Then the cases 7.4 is checked on, each on its own listing: a repair
 * with its problem, a taken cleaning whose booking is gone, a cell with more
 * chips than fit, and a person who no longer works here.
 */

interface StandProperty {
  id: number;
  name: string;
  parent_id: number | null;
  hostaway_unit_id: number | null;
  timezone: string;
}

interface StandBooking {
  id: number;
  property_id: number;
  arrival_date: string;
  departure_date: string;
  status: string;
  is_block: boolean;
  is_service_booking: boolean;
  rooms: { property_id: number }[];
}

const uuid = (serial: number) => `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`;

export const FIXTURE_STAFF = [
  { id: uuid(9001), full_name: 'Cleaner 1', role: 'cleaner', is_active: true },
  { id: uuid(9002), full_name: 'Cleaner 2', role: 'cleaner', is_active: true },
  { id: uuid(9003), full_name: 'Cleaner 3', role: 'cleaner', is_active: true },
  { id: uuid(9004), full_name: 'Technician 1', role: 'technician', is_active: true },
  { id: uuid(9005), full_name: 'Former Cleaner', role: 'cleaner', is_active: false },
];
const CLEANERS = FIXTURE_STAFF.slice(0, 3);
const TECHNICIAN = FIXTURE_STAFF[3];
const FORMER = FIXTURE_STAFF[4];

/** The listings that carry one case each of 7.4. */
const REPAIR_ROW = 1005;
const CHANGED_ROW = 1006;
const CROWDED_ROW = 1007;

const TODAY_STATUSES = ['in_progress', 'accepted', 'assigned', 'unassigned'];
const LATER_STATUSES = ['assigned', 'unassigned', 'accepted'];

function rowsOf(booking: StandBooking): number[] {
  return booking.rooms.length === 0
    ? [booking.property_id]
    : booking.rooms.map((room) => room.property_id);
}

function isGuest(booking: StandBooking): boolean {
  return (
    (booking.status === 'new' || booking.status === 'modified') &&
    !booking.is_block &&
    !booking.is_service_booking
  );
}

export function fixtureTasks(
  today: string,
  properties: readonly StandProperty[],
  bookings: readonly StandBooking[],
): Record<string, unknown>[] {
  const byId = new Map(properties.map((one) => [one.id, one]));
  let serial = 0;

  const task = (property: number, day: string, extra: Record<string, unknown>) => {
    serial += 1;
    const place = byId.get(property);
    const parent =
      place === undefined || place.parent_id === null ? undefined : byId.get(place.parent_id);
    const person = FIXTURE_STAFF.find((one) => one.id === extra.assignee_id);
    return {
      id: uuid(serial),
      property_id: property,
      reservation_id: null,
      problem_id: null,
      type: 'cleaning',
      status: 'assigned',
      priority: 0,
      assignee_id: null,
      created_by: null,
      scheduled_date: day,
      time_from: '10:00:00',
      time_to: '15:00:00',
      started_at: null,
      completed_at: extra.status === 'done' ? `${day}T12:00:00+00:00` : null,
      measured_minutes: null,
      duration_override_min: null,
      is_parallel: false,
      is_short_measurement: null,
      notes: null,
      title: null,
      title_i18n: null,
      created_at: `${day}T06:00:00+00:00`,
      property: {
        name: place?.name ?? String(property),
        hostaway_unit_id: place?.hostaway_unit_id ?? null,
        timezone: place?.timezone ?? null,
        parent: parent === undefined ? null : { name: parent.name },
      },
      assignee: person === undefined ? null : { full_name: person.full_name, role: person.role },
      author: null,
      problem: null,
      ...extra,
    };
  };

  const guests = bookings.filter(isGuest);
  const arrivals = new Set(
    guests.flatMap((booking) => rowsOf(booking).map((row) => `${row}:${booking.arrival_date}`)),
  );

  const cleanings = guests.flatMap((booking) =>
    rowsOf(booking).map((row) => {
      const offset = daysBetween(today, booking.departure_date);
      const status =
        offset < 0
          ? 'done'
          : offset === 0
            ? TODAY_STATUSES[serial % TODAY_STATUSES.length]
            : LATER_STATUSES[serial % LATER_STATUSES.length];
      const assignee =
        status === 'unassigned'
          ? null
          : serial % 17 === 0
            ? FORMER.id
            : CLEANERS[serial % CLEANERS.length].id;
      return task(row, booking.departure_date, {
        reservation_id: booking.id,
        status,
        assignee_id: assignee,
        priority: arrivals.has(`${row}:${booking.departure_date}`) ? 1 : 0,
      });
    }),
  );

  const cases = [
    // Listing 6: a repair — the chip leads to its problem.
    task(REPAIR_ROW, addDays(today, 1), {
      type: 'maintenance',
      problem_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
      problem: { title: 'Broken boiler', priority: 'high' },
      assignee_id: TECHNICIAN.id,
      time_from: '10:00:00',
      time_to: '11:00:00',
    }),
    // Listing 7: a taken cleaning whose booking is gone — the chip warns.
    task(CHANGED_ROW, addDays(today, 2), {
      reservation_id: 999999,
      status: 'accepted',
      assignee_id: CLEANERS[0].id,
    }),
    // Listing 8: more than a week's cell shows — «+N».
    task(CROWDED_ROW, addDays(today, 1), {
      assignee_id: CLEANERS[2].id,
      time_from: '09:00:00',
      time_to: '10:00:00',
    }),
    task(CROWDED_ROW, addDays(today, 1), {
      type: 'inspection',
      assignee_id: CLEANERS[1].id,
      time_from: '11:00:00',
      time_to: '12:00:00',
    }),
    task(CROWDED_ROW, addDays(today, 1), {
      type: 'midstay',
      status: 'unassigned',
      time_from: '13:00:00',
      time_to: '14:00:00',
    }),
  ];

  return [...cleanings, ...cases];
}
