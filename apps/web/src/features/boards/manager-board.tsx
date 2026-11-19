'use client';

import {
  BOARD_COLUMNS,
  orderCards,
  problemStatusTone,
  type BoardColumn,
  type CardOrder,
} from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { BoardColumnFrame } from '@/components/board/board-column';
import { useColumnDrag } from '@/components/board/use-column-drag';
import { StatusBadge } from '@/components/status-badge';
import { TONE_MARK_BG } from '@/lib/design/tone-classes';

import { CardTile, type CardActions } from './card-tile';
import { QuickAdd } from './quick-add';
import type { BoardCard } from './schema';

interface ManagerBoardProps {
  boardId: string;
  /** The cards on the board (not shelved), already searched and filtered. */
  cards: readonly BoardCard[];
  order: CardOrder;
  today: string;
  isFiltered: boolean;
  /** What may be done to a card; none for a card the viewer only reads. */
  actionsFor: (card: BoardCard) => CardActions | undefined;
  /** Every manager and admin on a live board: each column ends in a quick add. */
  canAdd: boolean;
  cardHref: (cardId: string) => string;
  /** A plain click on a card opens it over the board. */
  onOpen?: (cardId: string) => void;
  /** Names a card's board on its tile («Назначено мне», where cards of every board meet). */
  boardTitleOf?: (card: BoardCard) => string;
}

/**
 * The four columns of a manager board — the technicians' board's, under the
 * same words — side by side, scrolling sideways inside their frame on a narrow
 * screen. A card goes to any column by the mouse or by its menu; each column
 * ends in a quick add. An archived board is the same board without either.
 */
export function ManagerBoard({
  boardId,
  cards,
  order,
  today,
  isFiltered,
  actionsFor,
  canAdd,
  cardHref,
  onOpen,
  boardTitleOf,
}: ManagerBoardProps) {
  const { t } = useTranslation();
  const drag = useColumnDrag<BoardCard, BoardColumn>({
    columnOf: (card) => card.column_key,
    canMove: (card, column) => card.column_key !== column && actionsFor(card) !== undefined,
    onMove: (card, column) => actionsFor(card)?.onMove(card, column),
  });

  return (
    <div className="overflow-x-auto pb-1">
      <div
        data-slot="manager-board"
        className="grid grid-cols-[repeat(4,minmax(16rem,1fr))] items-start gap-3"
      >
        {BOARD_COLUMNS.map((column) => {
          const name = t(`problems.statuses.${column}`);
          const inColumn = orderCards(
            cards.filter((card) => card.column_key === column),
            order,
          );
          return (
            <BoardColumnFrame
              key={column}
              label={name}
              heading={<StatusBadge status={`problems.${column}`}>{name}</StatusBadge>}
              markClassName={TONE_MARK_BG[problemStatusTone(column)]}
              count={inColumn.length}
              isDroppable={drag.isDroppable(column)}
              isOver={drag.isOver(column)}
              drop={drag.column(column)}
              emptyText={isFiltered ? t('boards.columnEmptyFiltered') : t('boards.columnEmpty')}
              footer={canAdd ? <QuickAdd boardId={boardId} column={column} /> : undefined}
            >
              {inColumn.map((card) => {
                const actions = actionsFor(card);
                return (
                  <CardTile
                    key={card.id}
                    card={card}
                    today={today}
                    href={cardHref(card.id)}
                    onOpen={onOpen}
                    actions={actions}
                    drag={actions === undefined ? undefined : drag.item}
                    boardTitle={boardTitleOf?.(card)}
                  />
                );
              })}
            </BoardColumnFrame>
          );
        })}
      </div>
    </div>
  );
}
