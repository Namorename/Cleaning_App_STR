'use client';

import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface StandPreviewProps {
  /** What the real calendar would open; null keeps the card closed. */
  text: string | null;
  onClose: () => void;
}

/**
 * On the stand writing is off (docs/f10-plan.md, §5): the form and the
 * drawer read and write through the real client, so a chip or a cell opens
 * this card instead, saying what it would have opened.
 */
export function StandPreview({ text, onClose }: StandPreviewProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={text !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      {text === null ? null : (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('panel.calendar.stand.title')}</DialogTitle>
            <DialogDescription>{text}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      )}
    </Dialog>
  );
}
