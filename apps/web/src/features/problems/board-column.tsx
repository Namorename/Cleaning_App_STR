'use client';

import { problemStatusTone } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/status-badge';
import { TONE_MARK_BG } from '@/lib/design/tone-classes';
import { cn } from '@/lib/utils';

import type { ProblemsAddress } from './address';
import { menuMoves } from './board-moves';
import { ProblemCard } from './problem-card';
import type { BoardStatus, Problem } from './schema';
import type { CardDrag, ColumnDrop } from './use-board-drag';

interface BoardColumnProps {
  status: BoardStatus;
  /** The cards in this column. */
  problems: Problem[];
  /** A search narrows the board: an empty column then says "nothing found". */
  isFiltered: boolean;
  /** The dragged card may be dropped here. */
  isDroppable: boolean;
  /** The dragged card is over this column, and may be dropped here. */
  isOver: boolean;
  drop: ColumnDrop;
  drag: CardDrag;
  onMove: (problem: Problem, status: BoardStatus) => void;
  /** The breakages somebody wrote about that the manager has not read. */
  unread: ReadonlySet<string>;
  /** The board as it is filtered: a card's page carries it back. */
  from: ProblemsAddress;
}

/**
 * One column of the board: its status's tone and glyph at the head, the
 * count, the cards. While a card is dragged, the column it may go to is
 * outlined in the primary colour, dashed (the review of 05.10: a faint ring
 * alone was below 3:1); the card over it turns the outline solid. No words
 * in the head — the owner (05.10) found «Можно сюда» one sign too many.
 */
export function BoardColumn({
  status,
  problems,
  isFiltered,
  isDroppable,
  isOver,
  drop,
  drag,
  onMove,
  unread,
  from,
}: BoardColumnProps) {
  const { t } = useTranslation();
  const heading = t(`problems.statuses.${status}`);

  return (
    <section
      aria-label={heading}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
      data-droppable={isDroppable ? 'true' : undefined}
      className={cn(
        'flex min-h-32 flex-col gap-2 rounded-lg bg-muted/40 p-2 transition-colors',
        isDroppable && 'outline-2 outline-offset-2 outline-primary',
        isDroppable && (isOver ? 'bg-accent outline-solid' : 'outline-dashed'),
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1 rounded-full', TONE_MARK_BG[problemStatusTone(status)])}
      />
      <header className="flex items-center justify-between gap-2 px-1">
        <StatusBadge status={`problems.${status}`}>{heading}</StatusBadge>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {problems.length}
        </span>
      </header>
      {problems.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {isFiltered
            ? t('panel.problems.board.columnEmptyFiltered')
            : t('panel.problems.board.columnEmpty')}
        </p>
      ) : (
        problems.map((problem) => (
          <ProblemCard
            key={problem.id}
            problem={problem}
            moves={menuMoves(problem)}
            onMove={onMove}
            hasUnread={unread.has(problem.id)}
            from={from}
            onDragStart={drag.onDragStart}
            onDragEnd={drag.onDragEnd}
          />
        ))
      )}
    </section>
  );
}
