'use client';

import { BOARD_COLUMNS, isCardColor, type BoardColumn } from '@str-ops/shared';
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
import { cardPlace, type BoardCard, type CardShelf } from './schema';

export interface CardActions {
  onMove: (card: BoardCard, column: BoardColumn) => void;
  onDuplicate: (card: BoardCard) => void;
  onShelve: (card: BoardCard, shelf: CardShelf) => void;
}

interface CardTileProps {
  card: BoardCard;
  /** The device's day, `YYYY-MM-DD`: what the due date is read against. */
  today: string;
  /** Where the card opens: the board's address with `card=<id>`. */
  href: string;
  /** The owner or an admin: the menu and the drag; another manager only reads. */
  actions?: CardActions;
  drag?: ItemDrag<BoardCard>;
}

/**
 * One card on a manager board: its colour as a stripe and a faint fill, the
 * title (which opens it), the place, the due date and the steps' progress.
 * The menu «⋯» moves it to any other column, copies it, archives or deletes
 * it — so nothing is left to the mouse alone. The title's link covers the
 * card; the menu sits above it.
 */
export function CardTile({ card, today, href, actions, drag }: CardTileProps) {
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
          scroll={false}
          className="font-medium break-words outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {card.title}
        </Link>
        {actions === undefined ? null : <CardMenu card={card} actions={actions} />}
      </div>
      {place === null ? null : <span className="text-xs text-muted-foreground">{place}</span>}
      <DueChip dueOn={card.due_on} column={card.column_key} today={today} />
      <StepProgress steps={card.steps} />
      {hasColor ? <span className="sr-only">{t(`boards.colors.${card.color}`)}</span> : null}
    </article>
  );
}

function CardMenu({ card, actions }: { card: BoardCard; actions: CardActions }) {
  const { t } = useTranslation();
  const columns = BOARD_COLUMNS.filter((column) => column !== card.column_key);
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
          {columns.map((column) => (
            <DropdownMenuItem key={column} onClick={() => actions.onMove(card, column)}>
              {t('boards.moveToColumn', { column: t(`problems.statuses.${column}`) })}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => actions.onDuplicate(card)}>
            {t('boards.duplicate')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onShelve(card, 'archived')}>
            {t('boards.archiveCard')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onShelve(card, 'deleted')}>
            {t('boards.deleteCard')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
