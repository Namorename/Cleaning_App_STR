'use client';

import { useRef } from 'react';
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

interface ResetPasswordDialogProps {
  /** Whose password: the name as the row shows it. */
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The question before a password is reset. A reset cannot be undone: the old
 * password stops working the moment the new one is set, on the phone and in
 * the panel, and it used to happen on one press of a row's button.
 *
 * The focus starts on «Отмена», so an Enter pressed by habit keeps the old
 * password; Escape and «Отмена» close it with nothing sent. The answer goes to
 * the view, which owns the write and shows the new password after it.
 */
export function ResetPasswordDialog({ name, onConfirm, onClose }: ResetPasswordDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false} initialFocus={cancelRef}>
        <DialogHeader>
          <DialogTitle>{t('panel.team.resetConfirm.title', { name })}</DialogTitle>
          <DialogDescription>{t('panel.team.resetConfirm.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            className="h-11"
            onClick={onClose}
          >
            {t('panel.cancel')}
          </Button>
          <Button type="button" variant="destructive" className="h-11" onClick={onConfirm}>
            {t('panel.team.resetConfirm.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
