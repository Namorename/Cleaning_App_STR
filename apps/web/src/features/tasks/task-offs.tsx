'use client';

import type { Language } from '@str-ops/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import type { Task } from './schema';

type OffsOf = Pick<Task, 'status' | 'offs'>;

/**
 * What the office reads of a cleaning taken off (20261118120000): on a cleaning it cancelled,
 * who cancelled it, when, and why; on a cleaning a cleaner handed back and nobody has taken since,
 * «Отказ: Вера» or «Прервана, нужно закончить: Вера», and her words. The words are quoted as
 * typed. Nothing otherwise — and nothing for anybody but the office, whom alone the server gives
 * the marks.
 */
export function offLines(task: OffsOf, t: TFunction, language: Language): string[] {
  const offs = task.offs;
  if (offs === null) {
    return [];
  }
  const quoted = (reason: string | null) =>
    reason === null || reason.trim() === '' ? [] : [t('panel.tasks.offs.quoted', { reason })];
  if (task.status === 'cancelled' && offs.cancelled !== null) {
    return [
      t('panel.tasks.offs.cancelled', {
        name: offs.cancelled.by?.name ?? t('panel.tasks.offs.someone'),
        date: formatDateTime(offs.cancelled.at, language),
      }),
      ...quoted(offs.cancelled.reason),
    ];
  }
  if (task.status === 'unassigned' && offs.released !== null) {
    return [
      t(`panel.tasks.offs.${offs.released.kind}`, {
        name: offs.released.by?.name ?? t('panel.tasks.offs.someone'),
      }),
      ...quoted(offs.released.reason),
    ];
  }
  return [];
}

/** Has the office something to read here that the closing lines do not say? */
export function hasOffLines(task: OffsOf): boolean {
  const offs = task.offs;
  return (
    offs !== null &&
    ((task.status === 'cancelled' && offs.cancelled !== null) ||
      (task.status === 'unassigned' && offs.released !== null))
  );
}

interface TaskOffsProps {
  task: OffsOf;
  className?: string;
}

/** The lines of `offLines`: the mark first — said strongly on work waiting for a person — the words beneath. */
export function TaskOffs({ task, className }: TaskOffsProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const lines = offLines(task, t, language);
  if (lines.length === 0) {
    return null;
  }
  const [head, ...rest] = lines;
  return (
    <div className={cn('flex flex-col', className)} data-task-offs="">
      <span
        className={cn(
          'break-words whitespace-normal',
          task.status === 'unassigned' ? 'font-medium text-foreground' : null,
        )}
      >
        {head}
      </span>
      {rest.map((line) => (
        <span key={line} className="break-words whitespace-normal">
          {line}
        </span>
      ))}
    </div>
  );
}
