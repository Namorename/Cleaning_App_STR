'use client';

import { orderCards, problemStatusTone, type CardOrder } from '@str-ops/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BoardColumnFrame } from '@/components/board/board-column';
import { useColumnDrag } from '@/components/board/use-column-drag';
import { StatusBadge } from '@/components/status-badge';
import { TONE_MARK_BG } from '@/lib/design/tone-classes';

import { CardTile, type CardActions } from './card-tile';
import type { BoardLane } from './lanes';
import type { BoardCard } from './schema';

interface ManagerBoardProps {
  /** The lanes in their order: a board's live columns, or the four stages. */
  lanes: readonly BoardLane[];
  /** The key of the lane a card stands in. */
  laneOf: (card: BoardCard) => string;
  /** The cards on the board (not shelved), already searched and filtered. */
  cards: readonly BoardCard[];
  order: CardOrder;
  today: string;
  isFiltered: boolean;
  /** What may be done to a card; none for a card the viewer only reads. */
  actionsFor: (card: BoardCard) => CardActions | undefined;
  /** What ends a lane: a quick add, for every manager and admin on a live board. */
  footerOf?: (lane: BoardLane) => ReactNode;
  cardHref: (cardId: string) => string;
  /** A plain click on a card opens it over the board. */
  onOpen?: (cardId: string) => void;
  /** Names a card's board on its tile («Назначено мне», where cards of every board meet). */
  boardLabelOf?: (card: BoardCard) => string;
}

/** The narrowest a lane gets: past it, the lanes scroll sideways inside their frame. */
const LANE_MIN_WIDTH = '16rem';

/**
 * A manager board's lanes side by side — its own columns (20261126120000), or on «Назначено мне» the
 * four stages — scrolling sideways inside their frame on a narrow screen or a board of many
 * columns. Each lane is headed by its name in the tone of its stage; a long name ends in «…»
 * rather than widening the lane. A card goes to any other lane
 * by the mouse or by its menu; each lane may end in a quick add. An archived board is the same board
 * without either.
 */
export function ManagerBoard({
  lanes,
  laneOf,
  cards,
  order,
  today,
  isFiltered,
  actionsFor,
  footerOf,
  cardHref,
  onOpen,
  boardLabelOf,
}: ManagerBoardProps) {
  const { t } = useTranslation();
  const drag = useColumnDrag<BoardCard, string>({
    columnOf: laneOf,
    canMove: (card, lane) => laneOf(card) !== lane && actionsFor(card) !== undefined,
    onMove: (card, lane) => actionsFor(card)?.onMove(card, lane),
  });
  // The count of lanes is the board's: the grid's template is written here, not in a class.
  const template = {
    gridTemplateColumns: `repeat(${Math.max(lanes.length, 1)}, minmax(${LANE_MIN_WIDTH}, 1fr))`,
  };

  return (
    <div className="overflow-x-auto pb-1">
      <div data-slot="manager-board" className="grid items-start gap-3" style={template}>
        {lanes.map((lane) => {
          const inLane = orderCards(
            cards.filter((card) => laneOf(card) === lane.key),
            order,
          );
          const others = lanes.filter((other) => other.key !== lane.key);
          return (
            <BoardColumnFrame
              key={lane.key}
              label={lane.name}
              heading={
                <StatusBadge status={`problems.${lane.stage}`} className="min-w-0 shrink">
                  <span className="truncate" title={lane.name}>
                    {lane.name}
                  </span>
                </StatusBadge>
              }
              markClassName={TONE_MARK_BG[problemStatusTone(lane.stage)]}
              count={inLane.length}
              isDroppable={drag.isDroppable(lane.key)}
              isOver={drag.isOver(lane.key)}
              drop={drag.column(lane.key)}
              emptyText={isFiltered ? t('boards.columnEmptyFiltered') : t('boards.columnEmpty')}
              footer={footerOf?.(lane)}
            >
              {inLane.map((card) => {
                const actions = actionsFor(card);
                return (
                  <CardTile
                    key={card.id}
                    card={card}
                    today={today}
                    href={cardHref(card.id)}
                    onOpen={onOpen}
                    actions={actions}
                    moveTargets={others}
                    drag={actions === undefined ? undefined : drag.item}
                    boardLabel={boardLabelOf?.(card)}
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
