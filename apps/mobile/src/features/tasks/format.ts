import { isSameDayTurnover, type CleaningTask } from './schema';

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

/**
 * Why this cleaning is urgent, in the words a cleaner would use herself.
 *
 * The first version showed a red chip reading "Срочно" and left the reason and
 * the deadline to be inferred — the deadline sat in a separate line as
 * "· до 15:00", with nothing tying the two together. Priority 1 has exactly
 * one meaning in this system, so the card says it outright.
 */
export function urgencyText(task: CleaningTask): string {
  if (!isSameDayTurnover(task)) {
    return 'Обычная уборка: в этот день заезда нет';
  }

  const deadline = formatDeadline(task);
  const reason = 'Срочно: в этот день заезжает следующий гость';

  return deadline === null ? reason : `${reason} — успеть ${deadline}`;
}

export function propertyName(task: CleaningTask): string {
  return task.property?.name ?? `Объект ${task.property_id}`;
}
