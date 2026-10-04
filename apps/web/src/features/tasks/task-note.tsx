'use client';

import { StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TaskNoteProps {
  /** The manager's note for the executor, as stored. */
  note: string;
}

/**
 * A cleaning's note in the list (owner, 04.10): a small mark by the name, so
 * the row stays one line. Its text shows on hover and when the mark takes the
 * keyboard's focus; a screen reader hears it whole in the mark's name; the
 * form shows it in full. A 44 px target (`TOUCH_TARGET.panelMin`) around a
 * small icon. The icon is the map's `meta.note` (task-row.test holds the two together).
 */
export function TaskNote({ note }: TaskNoteProps) {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger
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
