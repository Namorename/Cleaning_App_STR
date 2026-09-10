'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { formatWindow, statusVariant, typeVariant } from './format';
import { isManualTask, isOverdue, isTaskClosed, localizedTitle, type Task } from './schema';
import { useCancelTask } from './use-tasks';

interface TaskCardProps {
  task: Task;
  /** Today as `YYYY-MM-DD`, so a whole list agrees on what "overdue" means. */
  today: string;
  onEdit: (task: Task) => void;
  onOpenWork: (task: Task) => void;
}

/** One job in the list: enough to know what it is, and the few things to do with it. */
export function TaskCard({ task, today, onEdit, onOpenWork }: TaskCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const cancel = useCancelTask();
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  const title = localizedTitle(task, language) ?? t(`panel.tasks.types.${task.type}`);
  const timeWindow = formatWindow(task.time_from, task.time_to, {
    from: (time) => t('panel.tasks.window.from', { time }),
    until: (time) => t('panel.tasks.window.until', { time }),
  });
  const closed = isTaskClosed(task);
  const overdue = isOverdue(task, today);
  const failure = cancel.isError ? serverErrorText(cancel.error) : null;

  return (
    <div data-slot="card" className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-medium">{title}</span>
        <div className="flex flex-wrap items-center gap-1">
          {overdue ? <Badge variant="destructive">{t('panel.tasks.overdue')}</Badge> : null}
          <Badge variant={typeVariant()}>{t(`panel.tasks.types.${task.type}`)}</Badge>
          <Badge variant={statusVariant(task.status)}>
            {t(`panel.tasks.statuses.${task.status}`)}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span>{task.property?.name ?? t('panel.tasks.noProperty')}</span>
        {timeWindow === null ? null : <span>{timeWindow}</span>}
        {/* The person doing it is the thing a schedule is read for: it keeps
            the foreground colour while the rest of the line stays quiet. */}
        <Person
          name={task.assignee?.full_name}
          role={task.assignee?.role}
          fallback={t('panel.tasks.noAssignee')}
          className={cn(task.assignee?.full_name != null && 'font-medium text-foreground')}
        />
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
        {task.status === 'done' ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenWork(task)}>
            {t('panel.tasks.actions.openWork')}
          </Button>
        ) : null}
        {closed || !isManualTask(task) ? null : isConfirmingCancel ? (
          <>
            <span className="text-muted-foreground">{t('panel.tasks.actions.cancelConfirm')}</span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(task.id)}
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

      {failure === null ? null : (
        <p role="alert" className="text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}
    </div>
  );
}
