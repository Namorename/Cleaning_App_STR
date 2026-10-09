import { formatDayHeading } from '@/features/tasks/format';
import { INTL_LOCALES, currentLanguage, i18n } from '@/i18n';

import type { BoardRepair, StaffMember } from './schema';

/** Separates the parts of one line: a day and its hours, a person and a day. */
export const PART_SEPARATOR = ' · ';

/** Every named person of the directory by id. A person without a name is left out. */
export function staffNames(staff: readonly StaffMember[] | undefined): ReadonlyMap<string, string> {
  return new Map(
    (staff ?? [])
      .map((person) => [person.id, person.full_name?.trim() ?? ''] as const)
      .filter(([, name]) => name !== ''),
  );
}

/**
 * A person by name. Somebody the directory does not know — deleted, from
 * before, nameless, or the directory not read yet — is a neutral word, never
 * an id: the reader has nothing to do with a uuid.
 */
export function personName(names: ReadonlyMap<string, string>, id: string | null): string {
  return (id === null ? undefined : names.get(id)) ?? i18n.t('problems.unknownPerson');
}

/** "10:00:00" as Postgres writes a time, shown as "10:00". */
function clockTime(value: string): string {
  return value.slice(0, 5);
}

/** The hours of a repair, as much of them as is known, or null for none. */
export function formatHours(from: string | null, to: string | null): string | null {
  if (from === null && to === null) {
    return null;
  }
  return `${from === null ? '' : clockTime(from)}–${to === null ? '' : clockTime(to)}`;
}

/** The day and hours of a live repair, the way her lists name a day: «Сегодня · 10:00–12:00». */
export function repairWhen(repair: BoardRepair): string | null {
  if (repair.scheduled_date === null) {
    return null;
  }
  const hours = formatHours(repair.time_from, repair.time_to);
  const day = formatDayHeading(repair.scheduled_date);
  return hours === null ? day : `${day}${PART_SEPARATOR}${hours}`;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const longDateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  cache: Map<string, Intl.DateTimeFormat>,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const locale = INTL_LOCALES[currentLanguage()];
  const formatter = cache.get(locale) ?? new Intl.DateTimeFormat(locale, options);
  cache.set(locale, formatter);
  return formatter;
}

/**
 * A calendar date as a date, not as «today»: a history is read days later.
 * Split by hand — `new Date('2026-10-09')` is midnight UTC, the day before to
 * anyone west of Greenwich.
 */
function calendarDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** «пт, 9 октября». */
export function formatDay(date: string): string {
  return formatterFor(dayFormatters, { weekday: 'short', day: 'numeric', month: 'long' }).format(
    calendarDate(date),
  );
}

/** «3 октября 2026 г.». */
export function formatLongDate(date: string): string {
  return formatterFor(longDateFormatters, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(calendarDate(date));
}
