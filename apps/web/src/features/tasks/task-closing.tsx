'use client';

import { cleaningClosingLines, isWorkerNameable } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { WhoDidItDialog, workerChoices } from '@/components/who-did-it-dialog';
import { WorkerMarkForm } from '@/components/worker-mark-form';
import { serverErrorText } from '@/lib/server-error';
import { cn } from '@/lib/utils';

import type { Task } from './schema';
import { useCleaners, useNameCleaningWorker } from './use-tasks';

interface TaskClosingProps {
  task: Pick<Task, 'status' | 'closing'>;
  className?: string;
}

/**
 * Who did a closed cleaning and who closed it (20261106125500): «Выполнила: Анна» with how that
 * is known in small print, «Отменил: менеджер Пётр», «Не состоялась: закрыта автоматически
 * (ночной проход)». Nothing while it is live.
 */
export function TaskClosing({ task, className }: TaskClosingProps) {
  const { t } = useTranslation();
  const lines = cleaningClosingLines(task.status, task.closing, t);
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className={cn('flex flex-col', className)}>
      {lines.map((line) => (
        <span key={line.text}>
          {line.text}
          {line.note === null ? null : (
            <span className="block text-xs text-muted-foreground">{line.note}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function useCleanerChoices(holder: { id: string; name: string | null } | null) {
  const { t } = useTranslation();
  const cleaners = useCleaners();
  return workerChoices(cleaners.data ?? [], holder, {
    unknown: t('panel.tasks.noAssignee'),
    holder: t('panel.tasks.complete.holder'),
  });
}

/** «Указать исполнителя» on a finished cleaning that says «не указано». */
export function CleaningWorkerMark({ task }: { task: Pick<Task, 'id' | 'status' | 'closing'> }) {
  const mark = useNameCleaningWorker();
  const people = useCleanerChoices(null);
  if (!isWorkerNameable(task.status, task.closing)) {
    return null;
  }
  return (
    <WorkerMarkForm
      id={task.id}
      people={people}
      isBusy={mark.isPending}
      failure={mark.isError ? serverErrorText(mark.error) : null}
      onSave={(personId) => mark.mutate({ taskId: task.id, personId })}
    />
  );
}

interface CompleteCleaningDialogProps {
  open: boolean;
  /** The cleaning being closed; kept while the dialog fades out. */
  task: Task | null;
  isBusy: boolean;
  onConfirm: (completedBy: string | null) => void;
  onClose: () => void;
}

/**
 * «Отметить выполненной?» with «Кто выполнил» (owner, 09.11): the cleaners at work, the one it
 * was given to first, then those switched off; «Никто, менеджер сам» by default.
 */
export function CompleteCleaningDialog({
  open,
  task,
  isBusy,
  onConfirm,
  onClose,
}: CompleteCleaningDialogProps) {
  const { t } = useTranslation();
  const holder =
    task?.assignee_id == null
      ? null
      : { id: task.assignee_id, name: task.assignee?.full_name ?? null };
  const people = useCleanerChoices(holder);

  return (
    <WhoDidItDialog
      open={open}
      words={{
        title: t('panel.tasks.complete.title'),
        description: t('panel.tasks.complete.text', { name: task?.property?.name ?? '' }),
        who: t('panel.tasks.complete.who'),
        alone: t('panel.tasks.complete.alone'),
        switchedOff: t('panel.tasks.complete.switchedOff'),
        hint: t('panel.tasks.complete.hint'),
        confirm: t('panel.tasks.complete.confirm'),
        abort: t('panel.tasks.complete.abort'),
      }}
      people={people}
      isBusy={isBusy}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
