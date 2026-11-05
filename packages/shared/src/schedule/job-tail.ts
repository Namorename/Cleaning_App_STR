/**
 * How long a live job has hung past its own day, and when that is overdue
 * (owner, 2026-11-05). One rule for both apps: the panel's «Уборки» and
 * «Задания», its dashboard's repair tiles and the head technician's board on
 * the phone all count by these, each for its own kind of job.
 */

/**
 * How many days a live job may hang undone past its day before it is
 * «Просрочено». Until then it only says how many days it hangs.
 */
export const OVERDUE_AFTER_DAYS = 3;

/** How long a live job has been hanging past its own day. */
export interface JobTail {
  /** Whole days since its day, in its listing's zone: 1 on the day after. */
  days: number;
  /** Hanging OVERDUE_AFTER_DAYS days or more. */
  isOverdue: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) / DAY_MS;
}

/**
 * The tail of a job standing on `day` as of `today`, both `YYYY-MM-DD`; null
 * while its day has not passed. Whether the job is still live is the
 * caller's to say: a closed job hangs nowhere.
 */
export function jobTail(day: string, today: string): JobTail | null {
  if (day >= today) {
    return null;
  }
  const days = dayNumber(today) - dayNumber(day);
  return { days, isOverdue: days >= OVERDUE_AFTER_DAYS };
}

/** The device's own calendar day as `YYYY-MM-DD`. */
export function localDay(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Building an Intl.DateTimeFormat costs far more than using one, and a list
// asks for its rows' today once a row.
const zoneFormats = new Map<string, Intl.DateTimeFormat>();

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  const known = zoneFormats.get(timeZone);
  if (known !== undefined) {
    return known;
  }
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  zoneFormats.set(timeZone, made);
  return made;
}

/**
 * Today's calendar day in a property's own time zone, as `YYYY-MM-DD` — the
 * day the server's staleness and grace rules count by. With no zone, or one
 * this engine cannot place (an unknown name, a phone whose Intl lacks zones),
 * the device's day stands in: a wrong zone must not blank a mark, and every
 * property today is in Central Europe, where the two agree.
 */
export function todayInZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  if (!timeZone) {
    return localDay(now);
  }
  try {
    const parts = zoneFormat(timeZone).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((one) => one.type === type)?.value ?? '';
    const day = `${part('year')}-${part('month')}-${part('day')}`;
    return ISO_DAY.test(day) ? day : localDay(now);
  } catch {
    // RangeError for a zone the engine does not know, TypeError where it has
    // no formatToParts. Fall back, as above.
    return localDay(now);
  }
}
