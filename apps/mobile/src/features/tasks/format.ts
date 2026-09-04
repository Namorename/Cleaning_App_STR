import { INTL_LOCALES, currentLanguage, i18n } from '@/i18n';

import { isSameDayTurnover, type CleaningTask } from './schema';

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

/**
 * Why this cleaning matters, in as few words as it takes.
 *
 * Priority 1 has exactly one meaning in this system — the next guest arrives
 * the same day — and the time is the only thing the cleaner has to plan
 * around, so the line is the time and the reason and nothing else.
 */
export function urgencyText(task: CleaningTask): string {
  if (!isSameDayTurnover(task)) {
    return i18n.t('tasks.urgency.noCheckIn');
  }

  const time = formatDeadlineTime(task);

  return time === null
    ? i18n.t('tasks.urgency.checkInSameDay')
    : i18n.t('tasks.urgency.checkInAt', { time });
}

export function propertyName(task: CleaningTask): string {
  return task.property?.name ?? i18n.t('tasks.unnamedProperty', { id: task.property_id });
}
