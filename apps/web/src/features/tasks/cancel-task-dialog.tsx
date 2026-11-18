'use client';

import { useId, useRef, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { isTaskClosed, type Task } from './schema';
import { taskSummary } from './task-row';
import { useCancelTask } from './use-tasks';

/** The server keeps a reason of up to this many characters (cancel_cleaning). */
export const CANCEL_REASON_MAX = 500;

interface CancelTaskDialogProps {
  /** The cleaning the manager asked to call off. */
  task: Task;
  onClose: () => void;
  /** Called off: whatever card asked may close too. */
  onCancelled?: () => void;
}

/**
 * The question before a cleaning is called off (owner, 2026-11-18: any cleaning, any status),
 * with room for why — the reason may stay empty. The dialog owns the write: it stays open on a
 * refusal and says it, so a row that refreshed away meanwhile, or a drawer behind it, loses
 * nothing. When somebody holds the live cleaning it says she will be told.
 */
export function CancelTaskDialog({ task, onClose, onCancelled }: CancelTaskDialogProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const cancel = useCancelTask();
  const [reason, setReason] = useState('');
  const reasonId = useId();
  // The focus starts on «Нет»: an Enter pressed by habit calls nothing off (team/confirm-dialog.tsx).
  const keepRef = useRef<HTMLButtonElement>(null);
  const failure = cancel.isError ? serverErrorText(cancel.error) : null;
  const tellsHolder = task.assignee_id !== null && !isTaskClosed(task);

  const confirm = () => {
    cancel.mutate(
      { taskId: task.id, reason },
      {
        onSuccess: () => {
          onCancelled?.();
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (open || cancel.isPending ? undefined : onClose())}>
      <DialogContent showCloseButton={false} initialFocus={keepRef}>
        <DialogHeader>
          <DialogTitle>{t('panel.tasks.actions.cancelConfirm')}</DialogTitle>
          <DialogDescription>{taskSummary(task, language, t)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor={reasonId}>{t('panel.tasks.offs.cancelReason')}</Label>
          <Textarea
            id={reasonId}
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {tellsHolder ? (
          <p className="text-sm text-muted-foreground">{t('panel.tasks.offs.cancelLive')}</p>
        ) : null}
        {failure === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {failure.text}
            {failure.detail === null ? null : (
              <span className="block text-xs text-muted-foreground">{failure.detail}</span>
            )}
          </p>
        )}
        <DialogFooter>
          <Button
            ref={keepRef}
            type="button"
            variant="outline"
            className="h-11"
            disabled={cancel.isPending}
            onClick={onClose}
          >
            {t('panel.tasks.actions.cancelConfirmNo')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11"
            disabled={cancel.isPending}
            onClick={confirm}
          >
            {t('panel.tasks.actions.cancelConfirmYes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
