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
  /** The owner or an admin; absent, the board is read only. */
  actions?: CardActions;
  cardHref: (cardId: string) => string;
}

/**
 * The four columns of a manager board — the technicians' board's, under the
 * same words — side by side, scrolling sideways inside their frame on a narrow
 * screen. A card goes to any column by the mouse or by its menu; each column
 * ends in a quick add. A reader sees the same board without either.
 */
export function ManagerBoard({
  boardId,
  cards,
  order,
  today,
  isFiltered,
  actions,
  cardHref,
}: ManagerBoardProps) {
  const { t } = useTranslation();
  const drag = useColumnDrag<BoardCard, BoardColumn>({
    columnOf: (card) => card.column_key,
    onMove: (card, column) => actions?.onMove(card, column),
  });
  const canEdit = actions !== undefined;

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
              isDroppable={canEdit && drag.isDroppable(column)}
              isOver={canEdit && drag.isOver(column)}
              drop={canEdit ? drag.column(column) : undefined}
              emptyText={isFiltered ? t('boards.columnEmptyFiltered') : t('boards.columnEmpty')}
              footer={canEdit ? <QuickAdd boardId={boardId} column={column} /> : undefined}
            >
              {inColumn.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  today={today}
                  href={cardHref(card.id)}
                  actions={actions}
                  drag={canEdit ? drag.item : undefined}
                />
              ))}
            </BoardColumnFrame>
          );
        })}
      </div>
    </div>
  );
}
