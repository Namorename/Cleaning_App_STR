'use client';

import type { Language } from '@str-ops/shared';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatShortDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { formatWindow, statusVariant, typeVariant } from './format';
import {
  isManualTask,
  isTaskClosed,
  localizedTitle,
  tailOf,
  taskPropertyName,
  type Task,
  type TaskTail,
} from './schema';

/**
 * The words on a task left behind its day: "since yesterday · check-out
 * 22.09" for a one-day tail, "Overdue · check-out 21.09" for an older one;
 * a task that is not from a booking names just the day.
 */
function tailLabel(task: Task, tail: TaskTail, language: Language, t: TFunction): string {
  const lead = tail.days === 1 ? t('panel.tasks.tail.yesterday') : t('panel.tasks.overdue');
  const day = formatShortDay(task.scheduled_date, language);
  const detail =
    task.reservation_id === null ? day : t('panel.tasks.tail.departure', { date: day });
  return `${lead} · ${detail}`;
}

interface TaskCardProps {
  task: Task;
  /** The instant the list was drawn at, so a whole list agrees on what a tail is. */
  now: Date;
  onEdit: (task: Task) => void;
  onOpenWork: (task: Task) => void;
  /**
   * Call the job off. The view owns the write: a refused cancel is answered
   * after the list has refreshed, and by then this card may have left the tab.
   */
  onCancel: (task: Task) => void;
  /** This card's cancel is on its way to the server. */
  isCancelling?: boolean;
  /** Somebody said something in the conversation about this job that the manager has not read. */
  hasUnread?: boolean;
}

/** One job in the list: enough to know what it is, and the few things to do with it. */
export function TaskCard({
  task,
  now,
  onEdit,
  onOpenWork,
  onCancel,
  isCancelling = false,
  hasUnread = false,
}: TaskCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  const title = localizedTitle(task, language) ?? t(`panel.tasks.types.${task.type}`);
  const timeWindow = formatWindow(task.time_from, task.time_to, {
    from: (time) => t('panel.tasks.window.from', { time }),
    until: (time) => t('panel.tasks.window.until', { time }),
  });
  const closed = isTaskClosed(task);
  // A live task left behind its day stays in the Today tab, framed and
  // labelled in words, not by colour alone.
  const tail = tailOf(task, now);

  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm',
        tail === null ? null : 'border-destructive/50',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-medium">{title}</span>
        <div className="flex flex-wrap items-center gap-1">
          {hasUnread ? <Badge>{t('panel.chat.unread')}</Badge> : null}
          {tail === null ? null : (
            <Badge variant="outline" className="border-destructive/50 text-destructive">
              {tailLabel(task, tail, language, t)}
            </Badge>
          )}
          <Badge variant={typeVariant()}>{t(`panel.tasks.types.${task.type}`)}</Badge>
          <Badge variant={statusVariant(task.status)}>
            {t(`panel.tasks.statuses.${task.status}`)}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span>{taskPropertyName(task) ?? t('panel.tasks.noProperty')}</span>
        {timeWindow === null ? null : <span>{timeWindow}</span>}
        {task.reservation_id !== null ? <span>{t('panel.tasks.origin.booking')}</span> : null}
        {task.problem_id !== null ? <span>{t('panel.tasks.origin.problem')}</span> : null}
        {task.author?.full_name == null ? null : (
          <span className="inline-flex items-center gap-1">
            {t('panel.tasks.authorLabel')}
            <Person name={task.author.full_name} role={task.author.role} />
          </span>
        )}
      </div>

      {task.notes === null ? null : <p className="text-muted-foreground">{task.notes}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {closed ? null : (
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(task)}>
            {t('panel.tasks.actions.edit')}
          </Button>
        )}
        {/* Beside the button that changes it: who the job is on is what the
            manager looks for before deciding to touch the task at all. */}
        <Person
          name={task.assignee?.full_name}
          role={task.assignee?.role}
          fallback={t('panel.tasks.noAssignee')}
          className={cn(
            'mr-1',
            task.assignee?.full_name == null ? 'text-muted-foreground' : 'font-medium',
          )}
        />
        {/* The drawer carries the conversation for every job, and the work
            of a finished one; the button is named after what it will show. */}
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenWork(task)}>
          {task.status === 'done'
            ? t('panel.tasks.actions.openWork')
            : t('panel.tasks.actions.openChat')}
        </Button>
        {closed || !isManualTask(task) ? null : isConfirmingCancel ? (
          <>
            <span className="text-muted-foreground">{t('panel.tasks.actions.cancelConfirm')}</span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isCancelling}
              onClick={() => onCancel(task)}
            >
              {t('panel.tasks.actions.cancelConfirmYes')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsConfirmingCancel(false)}
            >
              {t('panel.tasks.actions.cancelConfirmNo')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsConfirmingCancel(true)}
          >
            {t('panel.tasks.actions.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
