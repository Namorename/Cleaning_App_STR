import type { CleaningTask } from './schema';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  weekday: 'short',
});

const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * `scheduled_date` is a calendar date, not an instant. Parsing it with the
 * plain Date constructor would read it as midnight UTC and show the previous
 * day to anyone west of Greenwich, so the parts are split by hand.
 */
export function formatScheduledDate(task: CleaningTask): string {
  const [year, month, day] = task.scheduled_date.split('-').map(Number);
  return dateFormatter.format(new Date(year, month - 1, day));
}

/**
 * The deadline is a real instant and is shown in the phone's timezone — which
 * is the cleaner's own, and therefore the listing's.
 */
export function formatDeadline(task: CleaningTask): string | null {
  if (task.due_at === null) {
    return null;
  }
  return `до ${timeFormatter.format(new Date(task.due_at))}`;
}

export function propertyName(task: CleaningTask): string {
  return task.property?.name ?? `Объект ${task.property_id}`;
}
