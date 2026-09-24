import { propertyPath, splitPlace } from '@str-ops/shared';

import { localizedText } from '@/features/steps/schema';
import { INTL_LOCALES, currentLanguage, i18n } from '@/i18n';

import { isSameDayTurnover, startNotBefore, type CleaningTask } from './schema';

/**
 * Formatters are built per language and kept: constructing an
 * `Intl.DateTimeFormat` is not free and a list rebuilds every visible row.
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  cache: Map<string, Intl.DateTimeFormat>,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const locale = INTL_LOCALES[currentLanguage()];
  const cached = cache.get(locale);
  if (cached !== undefined) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(locale, options);
  cache.set(locale, formatter);
  return formatter;
}

/**
 * `scheduled_date` is a calendar date, not an instant. Parsing it with the
 * plain Date constructor would read it as midnight UTC and show the previous
 * day to anyone west of Greenwich, so the parts are split by hand.
 */
export function formatScheduledDate(task: CleaningTask): string {
  const [year, month, day] = task.scheduled_date.split('-').map(Number);

  return formatterFor(dateFormatters, {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  }).format(new Date(year, month - 1, day));
}

/**
 * The deadline is a real instant and is shown in the phone's timezone — which
 * is the cleaner's own, and therefore the listing's.
 */
export function formatDeadlineTime(task: CleaningTask): string | null {
  if (task.due_at === null) {
    return null;
  }

  return formatterFor(timeFormatters, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(task.due_at),
  );
}

/** Kinds whose banner names the job rather than a check-in: nobody arrives for them. */
const KINDS_NAMED_ON_BANNER: ReadonlySet<CleaningTask['type']> = new Set(['inspection', 'midstay']);

/**
 * Why this cleaning matters, in as few words as it takes.
 *
 * Priority 1 has exactly one meaning in this system — the next guest arrives
 * the same day — and the time is the only thing the cleaner has to plan
 * around, so the line is the time and the reason and nothing else.
 *
 * An inspection or a mid-stay cleaning has no check-in to plan around — a
 * midstay's guest is in the flat — so the line says what the job is: the
 * title the office gave it, in her language when translated, or else its kind.
 * The panel names these jobs the same way.
 */
export function urgencyText(task: CleaningTask): string {
  if (KINDS_NAMED_ON_BANNER.has(task.type)) {
    const title = task.title?.trim() ?? '';
    return title !== ''
      ? localizedText(title, task.title_i18n, currentLanguage())
      : i18n.t(`tasks.kinds.${task.type}`);
  }
  if (!isSameDayTurnover(task)) {
    return i18n.t('tasks.urgency.noCheckIn');
  }

  const time = formatDeadlineTime(task);

  return time === null
    ? i18n.t('tasks.urgency.checkInSameDay')
    : i18n.t('tasks.urgency.checkInAt', { time });
}

/** An instant — a start or a finish stamp — as a clock time on the phone. */
export function formatClockTime(instant: string): string {
  return formatterFor(timeFormatters, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(instant),
  );
}

/** "10:00:00" as Postgres writes a time, shown as "10:00". */
function clockTime(value: string): string {
  return value.slice(0, 5);
}

/**
 * The window as two clock times, or as much of it as is known.
 *
 * The window is planning information, not a deadline — the deadline is
 * `urgencyText`. A missing start is shown as an open dash rather than hidden,
 * because "–15:00" is still the one fact she has.
 */
export function formatWindow(task: CleaningTask): string | null {
  if (task.time_from === null && task.time_to === null) {
    return null;
  }
  const from = task.time_from === null ? '' : clockTime(task.time_from);
  const to = task.time_to === null ? '' : clockTime(task.time_to);

  return `${from}–${to}`;
}

/**
 * When a cleaning that cannot start yet will open, as one sentence.
 *
 * The window is a local clock time and the date is a calendar date, so both
 * are formatted from the local instant `startNotBefore` builds — never from
 * a UTC parse, for the reason given at `formatScheduledDate`.
 */
export function formatStartNotBefore(task: CleaningTask): string {
  const opensAt = startNotBefore(task);
  const time = formatterFor(timeFormatters, { hour: '2-digit', minute: '2-digit' }).format(opensAt);
  const date = formatterFor(dateFormatters, {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  }).format(opensAt);

  return i18n.t('tasks.detail.startsAt', { time, date });
}

/** What stands between a building and a room in one line of text. */

/** Where the cleaning is: the house, the room in it, and the street. */
export interface TaskPlace {
  /** The listing — the house she drives to. Never empty. */
  building: string;
  /** The room inside it, when the cleaning stands on one. */
  room: string | null;
  address: string | null;
}

/**
 * The place, taken apart for a screen that has two lines for it.
 *
 * A cleaning of a multi-unit listing stands on the room the guest slept in,
 * and a room is named by its number — "1 - 2109", "Unit 3 - 7013". That names
 * nothing she can drive to, so the house is read off the joined parent row and
 * the room becomes the second line. On an ordinary listing there is no parent
 * and its own name is the house.
 */
export function taskPlace(task: CleaningTask): TaskPlace {
  const property = task.property ?? null;
  if (property === null) {
    return {
      building: i18n.t('tasks.unnamedProperty', { id: task.property_id }),
      room: null,
      address: null,
    };
  }

  // `?? null` rather than a plain read: the query cache is restored from disk
  // by JSON.parse, so a row written by an older build reaches this line with
  // the keys that build knew and no others. Zod fills the defaults on the way
  // in from the network; nothing fills them on the way in from disk.
  const address = property.address ?? null;

  // The roomness test is not repeated here: `splitPlace` owns it, and it reads
  // both extras with `?? null` for exactly the reason above.
  return { ...splitPlace(property), address };
}

/**
 * The place in one line, for somewhere only one line fits — a screen title,
 * or the "where" of a problem report a manager will read.
 */
export function propertyName(task: CleaningTask): string {
  const place = taskPlace(task);
  return propertyPath(place.building, place.room);
}
