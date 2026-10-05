'use client';

import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TaskForm } from '@/features/tasks/task-form';
import { useTask } from '@/features/tasks/use-tasks';
import { serverErrorText } from '@/lib/server-error';

interface OffWorkFormProps {
  taskId: string;
  onClose: () => void;
}

/**
 * A job of «Уборки в работе у отключённых» opened for the decision
 * (docs/staff-disable-plan.md): the task form, where the manager hands it to
 * somebody who works — the form already offers the person switched off only
 * as "no access", and the server refuses her. The dashboard holds the job
 * narrow, so it is read whole first; until then a card says it is reading,
 * and a read that fails, or a job no longer there, says so in that card.
 */
export function OffWorkForm({ taskId, onClose }: OffWorkFormProps) {
  const { t } = useTranslation();
  const task = useTask(taskId);

  if (task.data !== undefined && task.data !== null) {
    return <TaskForm task={task.data} onClose={onClose} />;
  }
  const isMissing = task.isError || task.data === null;
  const failure = task.isError ? serverErrorText(task.error) : null;
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isMissing ? t('panel.calendar.taskMissing') : t('panel.tasks.loading')}
          </DialogTitle>
          <DialogDescription>{failure?.detail ?? ''}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
