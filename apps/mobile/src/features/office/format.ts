import type { TaskStatus } from '@str-ops/shared';
import type { TFunction } from 'i18next';

import { localizedText } from '@/features/steps/schema';
import { formatterFor } from '@/features/tasks/format';
import { currentLanguage } from '@/i18n';

import type { OfficeStatusFilter, OfficeTask } from './schema';

/** The status of a cleaning in the office's words: «Без исполнителя», «Назначена» … */
export function officeStatusText(status: TaskStatus, t: TFunction): string {
  return t(`office.statuses.${status}`);
}

export function statusFilterText(filter: OfficeStatusFilter, t: TFunction): string {
  return t(`office.statusFilters.${filter}`);
}

/**
 * Who is on it: the person's name, «Без исполнителя» for nobody, and the
 * neutral word for somebody whose name the read did not bring — never an id.
 */
export function assigneeText(task: Pick<OfficeTask, 'assignee_id' | 'assignee'>, t: TFunction): string {
  if (task.assignee_id === null) {
    return t('office.cleanings.nobody');
  }
  const name = task.assignee?.full_name?.trim() ?? '';
  return name === '' ? t('problems.unknownPerson') : name;
}

/**
 * What the job is: the title the office gave it, in the reader's language when
 * translated, or else its kind — as the panel names it.
 */
export function kindText(task: Pick<OfficeTask, 'type' | 'title' | 'title_i18n'>, t: TFunction): string {
  const title = task.title?.trim() ?? '';
  return title === ''
    ? t(`tasks.kinds.${task.type}`)
    : localizedText(title, task.title_i18n, currentLanguage());
}

const offFormatters = new Map<string, Intl.DateTimeFormat>();

/** «18 нояб., 09:40»: when the office took it off, on the phone's clock. */
export function formatOffAt(instant: string): string {
  return formatterFor(offFormatters, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
}

/**
 * What the office reads of a cleaning taken off (20261118120000), as the
 * panel's `offLines` says it: on a cleaning it cancelled, who cancelled it,
 * when, and why; on one a cleaner handed back and nobody has taken since,
 * «Отказ: Вера» or «Прервана, нужно закончить: Вера», and her words, quoted as
 * typed. Nothing otherwise.
 */
export function offLines(task: Pick<OfficeTask, 'status' | 'offs'>, t: TFunction): string[] {
  const offs = task.offs;
  if (offs === null) {
    return [];
  }
  const quoted = (reason: string | null): string[] =>
    reason === null || reason.trim() === '' ? [] : [t('office.offs.quoted', { reason })];
  if (task.status === 'cancelled' && offs.cancelled !== null) {
    return [
      t('office.offs.cancelled', {
        name: offs.cancelled.by?.name ?? t('office.offs.someone'),
        date: formatOffAt(offs.cancelled.at),
      }),
      ...quoted(offs.cancelled.reason),
    ];
  }
  if (task.status === 'unassigned' && offs.released !== null) {
    return [
      t(`office.offs.${offs.released.kind}`, {
        name: offs.released.by?.name ?? t('office.offs.someone'),
      }),
      ...quoted(offs.released.reason),
    ];
  }
  return [];
}
