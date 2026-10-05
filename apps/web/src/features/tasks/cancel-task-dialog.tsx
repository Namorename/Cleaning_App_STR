'use client';

import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/use-language';

import type { Task } from './schema';
import { taskSummary } from './task-row';

interface CancelTaskDialogProps {
  /** The job the manager asked to call off. */
  task: Task;
  onConfirm: (task: Task) => void;
  onClose: () => void;
}

/**
 * The question before a job is called off. It used to stand inside the card;
 * a table row has no room for it, so it asks in a dialog that names the job.
 * The answer goes to the view, which owns the write: a refusal arrives after
 * the list has refreshed, when the row may have moved to another tab.
 */
export function CancelTaskDialog({ task, onConfirm, onClose }: CancelTaskDialogProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('panel.tasks.actions.cancelConfirm')}</DialogTitle>
          <DialogDescription>{taskSummary(task, language, t)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {t('panel.tasks.actions.cancelConfirmNo')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11"
            onClick={() => onConfirm(task)}
          >
            {t('panel.tasks.actions.cancelConfirmYes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
