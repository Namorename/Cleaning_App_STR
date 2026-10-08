'use client';

import { useState } from 'react';
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

import { AssignForm } from './assign-form';
import type { Problem } from './schema';

interface AssignMoveDialogProps {
  open: boolean;
  /** The card being assigned; kept while the dialog fades out. */
  problem: Problem | null;
  onClose: () => void;
}

/** The technician form a move to «Назначено» opens — by the menu and by the mouse alike. */
export function AssignMoveDialog({ open, problem, onClose }: AssignMoveDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('panel.problems.board.assignTitle')}</DialogTitle>
          <DialogDescription>{problem?.title}</DialogDescription>
        </DialogHeader>
        {open && problem !== null ? (
          <AssignForm problem={problem} fixTask={null} onAssigned={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmMoveDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  abortLabel: string;
  /** The move takes something away: its button wears the destructive colours. */
  isDestructive?: boolean;
  /** The request this move sends is on its way. */
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The question a move asks before anything is sent: «Отметить выполненным?»,
 * «Снять техника с работы?». The dialog closes when the server has answered;
 * until then its button takes one press — a second one sends nothing more.
 */
export function ConfirmMoveDialog({
  open,
  title,
  description,
  confirmLabel,
  abortLabel,
  isDestructive = false,
  isBusy,
  onConfirm,
  onClose,
}: ConfirmMoveDialogProps) {
  const [isSent, setIsSent] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setIsSent(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {abortLabel}
          </Button>
          <Button
            type="button"
            variant={isDestructive ? 'destructive' : 'default'}
            className="h-11"
            disabled={isBusy || isSent}
            onClick={() => {
              setIsSent(true);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
