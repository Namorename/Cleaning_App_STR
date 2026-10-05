'use client';

import { StickyNote } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TaskNoteProps {
  /** The manager's note for the executor, as stored. */
  note: string;
}

/**
 * A cleaning's note in the list (owner, 04.10): a small mark by the name, so
 * the row stays one line. Its text shows on hover, when the mark takes the
 * keyboard's focus, and on a press — a phone has neither hover nor focus on a
 * tap (the review of 04.10); a press only opens, the way out is Escape, a
 * press elsewhere or the pointer leaving. A screen reader hears the text
 * whole in the mark's name; the form shows it in full. A 44 px target
 * (`TOUCH_TARGET.panelMin`) around a small icon. The icon is the map's
 * `meta.note` (task-row.test holds the two together).
 */
export function TaskNote({ note }: TaskNoteProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Tooltip open={isOpen} onOpenChange={setIsOpen}>
      <TooltipTrigger
        closeOnClick={false}
        onClick={() => setIsOpen(true)}
        render={
          <Button
            type="button"
            variant="ghost"
            className="size-11 shrink-0 text-muted-foreground"
            aria-label={t('panel.tasks.note', { text: note })}
          />
        }
      >
        <StickyNote aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-line">{note}</TooltipContent>
    </Tooltip>
  );
}
