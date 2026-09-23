'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { formatWindow, statusVariant, typeVariant } from './format';
import {
  isManualTask,
  isOverdue,
  isTaskClosed,
  localizedTitle,
  taskPropertyName,
  type Task,
} from './schema';

interface TaskCardProps {
  task: Task;
  /** Today as `YYYY-MM-DD`, so a whole list agrees on what "overdue" means. */
  today: string;
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
  today,
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
  const overdue = isOverdue(task, today);

  return (
    <div data-slot="card" className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-medium">{title}</span>
        <div className="flex flex-wrap items-center gap-1">
          {hasUnread ? <Badge>{t('panel.chat.unread')}</Badge> : null}
          {overdue ? <Badge variant="destructive">{t('panel.tasks.overdue')}</Badge> : null}
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
