'use client';

import { problemStatusTone } from '@str-ops/shared';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { BoardColumnFrame } from '@/components/board/board-column';
import { StatusBadge } from '@/components/status-badge';
import { TONE_MARK_BG } from '@/lib/design/tone-classes';

import type { ProblemsAddress } from './address';
import { menuMoves } from './board-moves';
import { filtersKey } from './filters';
import { ProblemCard } from './problem-card';
import type { BoardStatus, Problem } from './schema';
import { ShowMoreButton, useShowMore, WHOLE, type PageSize } from './show-more';
import type { CardDrag, ColumnDrop } from './use-board-drag';

interface BoardColumnProps {
  status: BoardStatus;
  /** The cards in this column, in the order they show. */
  problems: Problem[];
  /** How many show at first and with each «Показать ещё»; all of them by default. */
  page?: PageSize;
  /** A search narrows the board: an empty column then says "nothing found". */
  isFiltered: boolean;
  /** The dragged card may be dropped here. */
  isDroppable: boolean;
  /** The dragged card is over this column, and may be dropped here. */
  isOver: boolean;
  drop: ColumnDrop;
  drag: CardDrag;
  onMove: (problem: Problem, status: BoardStatus) => void;
  /** «В архив» from a card's menu. */
  onArchive?: (problem: Problem) => void;
  /** The breakages somebody wrote about that the manager has not read. */
  unread: ReadonlySet<string>;
  /** The board as it is filtered: a card's page carries it back. */
  from: ProblemsAddress;
}

/**
 * One column of the board, in the frame every board's columns share (`BoardColumnFrame`): its
 * status's tone and glyph at the head, the count, the cards scrolling under them. While a card is
 * dragged, the column it may go to is outlined in the primary colour, dashed (the review of 05.10: a
 * faint ring alone was below 3:1); the card over it turns the outline solid. No words in the head —
 * the owner (05.10) found «Можно сюда» one sign too many.
 *
 * A column given a page shows that many cards and «Показать ещё» under them, in the scrolling box
 * (owner, 10.10); the head still counts them all.
 */
export function BoardColumn({
  status,
  problems,
  page = WHOLE,
  isFiltered,
  isDroppable,
  isOver,
  drop,
  drag,
  onMove,
  onArchive,
  unread,
  from,
}: BoardColumnProps) {
  const { t } = useTranslation();
  const heading = t(`problems.statuses.${status}`);
  const cardsRef = useRef<HTMLDivElement>(null);
  const paging = useShowMore({
    total: problems.length,
    page,
    listRef: cardsRef,
    itemSelector: ':scope > article',
    resetKey: filtersKey(from.filters),
  });

  return (
    <BoardColumnFrame
      label={heading}
      heading={<StatusBadge status={`problems.${status}`}>{heading}</StatusBadge>}
      markClassName={TONE_MARK_BG[problemStatusTone(status)]}
      count={problems.length}
      isDroppable={isDroppable}
      isOver={isOver}
      drop={drop}
      emptyText={
        isFiltered
          ? t('panel.problems.board.columnEmptyFiltered')
          : t('panel.problems.board.columnEmpty')
      }
      listRef={cardsRef}
    >
      {problems.slice(0, paging.shown).map((problem) => (
        <ProblemCard
          key={problem.id}
          problem={problem}
          moves={menuMoves(problem)}
          onMove={onMove}
          onArchive={onArchive}
          hasUnread={unread.has(problem.id)}
          from={from}
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
        />
      ))}
      <ShowMoreButton more={paging.more} total={problems.length} onPress={paging.showMore} />
    </BoardColumnFrame>
  );
}
