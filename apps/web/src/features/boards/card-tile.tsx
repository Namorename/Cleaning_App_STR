'use client';

import { isCardColor } from '@str-ops/shared';
import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useId, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { CARD_COLOR_CLASS, cardColorStyle } from '@/components/board/card-color';
import type { ItemDrag } from '@/components/board/use-column-drag';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { DueChip, StepProgress } from './due-chip';
import type { BoardLane } from './lanes';
import { openPlainly } from './open-plainly';
import { cardPlace, initialsOf, type BoardCard, type CardShelf } from './schema';

/**
 * What can be done to one card from the board — by every manager and admin on a live board: a move
 * to another lane (by its key: a column's id, or a stage on «Назначено мне»), and where the view
 * offers them, a copy and the shelves.
 */
export interface CardActions {
  onMove: (card: BoardCard, lane: string) => void;
  onDuplicate?: (card: BoardCard) => void;
  onShelve?: (card: BoardCard, shelf: CardShelf) => void;
}

interface CardTileProps {
  card: BoardCard;
  /** The device's day, `YYYY-MM-DD`: what the due date is read against. */
  today: string;
  /** Where the card opens: the board's address with `card=<id>`. */
  href: string;
  /** A plain click opens the card over the board ('openPlainly'). */
  onOpen?: (cardId: string) => void;
  /** The menu and the drag; absent on an archived board, where the cards are read. */
  actions?: CardActions;
  /** The lanes the menu moves the card to: every lane but its own. */
  moveTargets?: readonly Pick<BoardLane, 'key' | 'name'>[];
  drag?: ItemDrag<BoardCard>;
  /** The line that names the card's board on a card shown away from it («Назначено мне»). */
  boardLabel?: string;
}

/**
 * One card on a manager board: its colour as a stripe and a faint fill, the
 * title (which opens it), the place, the due date and the steps' progress.
 * The menu «⋯» moves it to any other column, copies it, archives or deletes
 * it — so nothing is left to the mouse alone. The title's link covers the
 * card; the menu sits above it.
 */
export function CardTile({
  card,
  today,
  href,
  onOpen,
  actions,
  moveTargets = [],
  drag,
  boardLabel,
}: CardTileProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const place = cardPlace(card);
  const hasColor = isCardColor(card.color);
  const draggable = actions !== undefined && drag !== undefined;

  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    // Firefox starts a drag only when something is set; the id is handy anyway.
    event.dataTransfer?.setData('text/plain', card.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    drag?.onDragStart(card);
  };

  return (
    <article
      aria-labelledby={titleId}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? drag?.onDragEnd : undefined}
      style={cardColorStyle(card.color)}
      className={cn(
        'relative flex flex-col gap-1.5 rounded-lg border p-3 text-sm shadow-xs transition-shadow hover:shadow-md has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50',
        hasColor ? CARD_COLOR_CLASS : 'bg-card',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          id={titleId}
          href={href}
          onClick={(event) =>
            openPlainly(event, onOpen === undefined ? undefined : () => onOpen(card.id))
          }
          scroll={false}
          className="font-medium break-words outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {card.title}
        </Link>
        {actions === undefined ? null : (
          <CardMenu card={card} actions={actions} moveTargets={moveTargets} />
        )}
      </div>
      {boardLabel === undefined ? null : (
        <span className="text-xs text-muted-foreground">{boardLabel}</span>
      )}
      {place === null ? null : <span className="text-xs text-muted-foreground">{place}</span>}
      <DueChip dueOn={card.due_on} column={card.column_key} today={today} />
      {card.steps.length === 0 && card.assignee_id === null ? null : (
        <div className="flex items-center justify-between gap-2">
          <StepProgress steps={card.steps} />
          <AssigneeMark card={card} />
        </div>
      )}
      {hasColor ? <span className="sr-only">{t(`boards.colors.${card.color}`)}</span> : null}
    </article>
  );
}

/** The assignee's initials in the card's corner, the full name for a reader and on hover. */
function AssigneeMark({ card }: { card: BoardCard }) {
  const { t } = useTranslation();
  if (card.assignee_id === null) {
    return null;
  }
  const name = card.assignee?.full_name ?? t('boards.unknownPerson');
  const label = t('boards.assigneeOn', { name });
  return (
    <span
      title={label}
      className="relative z-10 ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground"
    >
      <span aria-hidden="true">{initialsOf(name) || '?'}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function CardMenu({
  card,
  actions,
  moveTargets,
}: {
  card: BoardCard;
  actions: CardActions;
  moveTargets: readonly Pick<BoardLane, 'key' | 'name'>[];
}) {
  const { t } = useTranslation();
  return (
    <div className="relative z-10 -mt-2.5 -mr-2.5 shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" className="size-11" />}
          aria-label={t('boards.cardMenu', { title: card.title })}
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {moveTargets.map((lane) => (
            <DropdownMenuItem key={lane.key} onClick={() => actions.onMove(card, lane.key)}>
              {t('boards.moveToColumn', { column: lane.name })}
            </DropdownMenuItem>
          ))}
          {(actions.onDuplicate === undefined && actions.onShelve === undefined) ||
          moveTargets.length === 0 ? null : (
            <DropdownMenuSeparator />
          )}
          {actions.onDuplicate === undefined ? null : (
            <DropdownMenuItem onClick={() => actions.onDuplicate?.(card)}>
              {t('boards.duplicate')}
            </DropdownMenuItem>
          )}
          {actions.onShelve === undefined ? null : (
            <>
              <DropdownMenuItem onClick={() => actions.onShelve?.(card, 'archived')}>
                {t('boards.archiveCard')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onShelve?.(card, 'deleted')}>
                {t('boards.deleteCard')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
