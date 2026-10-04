'use client';

import { STATUS_TONE } from '@str-ops/shared';
import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useId, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatShortDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { isDraggable, liveFixTask, problemPlace, type BoardStatus, type Problem } from './schema';

interface ProblemCardProps {
  problem: Problem;
  /** The columns the card's menu can send it to, in the board's order. */
  moves?: readonly BoardStatus[];
  /** Send the card to a column, as a drop there would. */
  onMove?: (problem: Problem, status: BoardStatus) => void;
  /** Fired when the manager picks the card up; absent on a board that cannot move cards. */
  onDragStart?: (problem: Problem) => void;
  onDragEnd?: () => void;
  /** Somebody said something about this breakage that the manager has not read. */
  hasUnread?: boolean;
}

/**
 * One problem on the board (5.4, variant A): compact — the title, which opens
 * the page, the place, the technician and the day; the urgency only when it
 * is not the usual one. Its menu «⋯» moves it between columns, so a move is
 * not left to the mouse alone.
 *
 * The title's link covers the card, so the whole card still opens the page;
 * the menu sits above it, outside the link.
 */
export function ProblemCard({
  problem,
  moves = [],
  onMove,
  onDragStart,
  onDragEnd,
  hasUnread = false,
}: ProblemCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const titleId = useId();
  const fixTask = liveFixTask(problem);
  const draggable = onDragStart !== undefined && isDraggable(problem);

  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    // Firefox starts a drag only when something is set; the id is handy anyway.
    event.dataTransfer?.setData('text/plain', problem.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    onDragStart?.(problem);
  };

  return (
    <article
      aria-labelledby={titleId}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      className={cn(
        'relative flex flex-col gap-1 rounded-lg border bg-card p-3 text-sm shadow-xs hover:bg-accent has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          id={titleId}
          href={`/problems/${problem.id}`}
          className="font-medium outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {problem.title}
        </Link>
        {onMove === undefined || moves.length === 0 ? null : (
          <div className="relative z-10 -mt-2.5 -mr-2.5 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="ghost" className="size-11" />}
                aria-label={t('panel.problems.board.cardMenu', { title: problem.title })}
              >
                <Ellipsis aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {moves.map((status) => (
                  <DropdownMenuItem key={status} onClick={() => onMove(problem, status)}>
                    {t('panel.problems.board.moveTo', {
                      status: t(`problems.statuses.${status}`),
                    })}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <span className="text-muted-foreground">
        {problemPlace(problem) ?? t('problems.noProperty')}
      </span>
      {fixTask === null ? null : (
        <span className="text-xs text-muted-foreground">
          <Person
            name={fixTask.assignee?.full_name}
            role={fixTask.assignee?.role}
            fallback={t('panel.problems.unknownPerson')}
          />{' '}
          · {formatShortDay(fixTask.scheduled_date, language)}
        </span>
      )}
      {hasUnread || problem.priority !== 'normal' ? (
        <div className="flex flex-wrap items-center gap-1">
          {problem.priority === 'normal' ? null : (
            <StatusBadge status={`problems.priority.${problem.priority}`}>
              {t(`problems.priorities.${problem.priority}`)}
            </StatusBadge>
          )}
          {hasUnread ? (
            <Badge tone={STATUS_TONE['chat.unread']}>{t('panel.chat.unread')}</Badge>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
