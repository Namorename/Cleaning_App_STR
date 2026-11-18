'use client';

import { dueState, stepCount, type CardStepMark } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { formatShortDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

interface DueChipProps {
  dueOn: string | null;
  column: string;
  today: string;
}

/**
 * A card's due date: in the overdue tone past it, in the honey of «today» on
 * it, plain otherwise — and plain on a card in «Выполнено», whose date no
 * longer warns. Nothing at all for a card without one.
 */
export function DueChip({ dueOn, column, today }: DueChipProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  if (dueOn === null) {
    return null;
  }
  const day = formatShortDay(dueOn, language);
  switch (dueState(dueOn, today, column)) {
    case 'overdue':
      return <Badge tone="overdue">{t('boards.dueChip.overdue', { day })}</Badge>;
    case 'today':
      return <Badge tone="today">{t('boards.dueChip.today')}</Badge>;
    default:
      return (
        <span className="text-xs text-muted-foreground">{t('boards.dueChip.day', { day })}</span>
      );
  }
}

interface StepProgressProps {
  steps: readonly CardStepMark[];
}

/** «3/7» and a thin bar; the sentence for a screen reader. Nothing for a card with no steps. */
export function StepProgress({ steps }: StepProgressProps) {
  const { t } = useTranslation();
  const { done, total } = stepCount(steps);
  if (total === 0) {
    return null;
  }
  const percent = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="tabular-nums">
        {done}/{total}
      </span>
      <span className="sr-only">{t('boards.progress', { done, total })}</span>
      <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-1 rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}
