'use client';

import Link from 'next/link';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/use-language';

import { formatDay, priorityVariant } from './format';
import { isDraggable, liveFixTask, type Problem } from './schema';

interface ProblemCardProps {
  problem: Problem;
  /** Fired when the manager picks the card up; absent on a board that cannot move cards. */
  onDragStart?: (problem: Problem) => void;
  onDragEnd?: () => void;
}

/** One problem on the board: enough to decide whether to open it, and a handle to move it. */
export function ProblemCard({ problem, onDragStart, onDragEnd }: ProblemCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const fixTask = liveFixTask(problem);
  const assignee = fixTask?.assignee?.full_name ?? null;
  const draggable = onDragStart !== undefined && isDraggable(problem);

  const handleDragStart = (event: DragEvent<HTMLAnchorElement>) => {
    // Firefox starts a drag only when something is set; the id is handy anyway.
    event.dataTransfer?.setData('text/plain', problem.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    onDragStart?.(problem);
  };

  return (
    <Link
      href={`/problems/${problem.id}`}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-xs hover:bg-accent',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{problem.title}</span>
        <Badge variant={priorityVariant(problem.priority)}>
          {t(`problems.priorities.${problem.priority}`)}
        </Badge>
      </div>
      <span className="text-muted-foreground">
        {problem.property?.name ?? t('problems.noProperty')}
      </span>
      {fixTask !== null ? (
        <span className="text-xs text-muted-foreground">
          {assignee ?? t('panel.problems.unknownPerson')} ·{' '}
          {formatDay(fixTask.scheduled_date, language)}
        </span>
      ) : null}
    </Link>
  );
}
