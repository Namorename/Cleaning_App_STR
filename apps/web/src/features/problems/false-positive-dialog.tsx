'use client';

import { useId, useState } from 'react';
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

type Choice = 'archive' | 'delete';
const CHOICES: readonly Choice[] = ['archive', 'delete'];

interface FalsePositiveDialogProps {
  /** Still open and never sent to anybody: «Удалить» is offered beside the archive. */
  mayDelete: boolean;
  isBusy: boolean;
  onConfirm: (isDelete: boolean) => void;
  onClose: () => void;
}

/**
 * «Ложное срабатывание» (docs/guest-signals.md §7.3; the owner's decision 8):
 * the archive by default, the delete only while nobody has worked on the task.
 * The verdict is what the readers learn from, so the dialog says so.
 */
export function FalsePositiveDialog({
  mayDelete,
  isBusy,
  onConfirm,
  onClose,
}: FalsePositiveDialogProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const [choice, setChoice] = useState<Choice>('archive');

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('panel.problems.falsePositive.action')}</DialogTitle>
          <DialogDescription>{t('panel.problems.falsePositive.text')}</DialogDescription>
        </DialogHeader>
        {mayDelete ? (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 font-medium">{t('panel.problems.falsePositive.choice')}</legend>
            {CHOICES.map((option) => (
              <label key={option} className="flex min-h-11 items-start gap-2">
                <input
                  type="radio"
                  name={`${baseId}-choice`}
                  value={option}
                  className="mt-0.5 size-4"
                  checked={choice === option}
                  onChange={() => setChoice(option)}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{t(`panel.problems.falsePositive.${option}`)}</span>
                  <span className="text-muted-foreground">
                    {t(`panel.problems.falsePositive.${option}Hint`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <p>{t('panel.problems.falsePositive.archiveHint')}</p>
            <p className="text-muted-foreground">
              {t('panel.problems.falsePositive.deleteUnavailable')}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {t('panel.problems.falsePositive.abort')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11"
            disabled={isBusy}
            onClick={() => onConfirm(mayDelete && choice === 'delete')}
          >
            {t(`panel.problems.falsePositive.${choice}Confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
