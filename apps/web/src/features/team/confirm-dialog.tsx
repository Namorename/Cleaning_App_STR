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

interface ConfirmDialogProps {
  /** The question, with the person's name in it. */
  title: string;
  /** What the answer takes away, a line each. */
  lines: readonly string[];
  /** The answer that goes ahead: the action's own word, not «OK». */
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The question before a step in «Команда» the panel cannot take back: a
 * password reset, an account switched off, a new role, a listing taken off.
 *
 * The focus starts on «Отмена», so an Enter pressed by habit changes nothing;
 * Escape and «Отмена» close it with nothing sent. The answer goes back to the
 * caller, which owns the write. Rendered inside another dialog, it opens over
 * it and leaves it as it was.
 */
export function ConfirmDialog({ title, lines, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false} initialFocus={cancelRef}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </DialogDescription>
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
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
