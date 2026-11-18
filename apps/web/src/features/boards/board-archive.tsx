'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { cardPlace, shelfOf, type BoardCard } from './schema';

interface BoardArchiveProps {
  /** The board's shelved cards, already searched and filtered. */
  cards: readonly BoardCard[];
  cardHref: (cardId: string) => string;
  /** The owner or an admin may bring a card back. */
  onRestore?: (card: BoardCard) => void;
  isBusy?: boolean;
}

/**
 * The board's archive: the cards put away — done projects, mostly — and,
 * apart, the deleted ones. Nothing is gone for good: each comes back to the
 * column it left with «Вернуть».
 */
export function BoardArchive({ cards, cardHref, onRestore, isBusy = false }: BoardArchiveProps) {
  const { t } = useTranslation();
  const archived = cards.filter((card) => shelfOf(card) === 'archived');
  const deleted = cards.filter((card) => shelfOf(card) === 'deleted');
  return (
    <div className="flex flex-col gap-6">
      <Shelf
        title={t('boards.archivedCards')}
        empty={t('boards.archiveEmpty')}
        cards={archived}
        at={(card) => card.archived_at}
        cardHref={cardHref}
        onRestore={onRestore}
        isBusy={isBusy}
      />
      <Shelf
        title={t('boards.deletedCards')}
        empty={t('boards.deletedEmpty')}
        cards={deleted}
        at={(card) => card.deleted_at}
        cardHref={cardHref}
        onRestore={onRestore}
        isBusy={isBusy}
      />
    </div>
  );
}

interface ShelfProps {
  title: string;
  empty: string;
  cards: readonly BoardCard[];
  at: (card: BoardCard) => string | null;
  cardHref: (cardId: string) => string;
  onRestore?: (card: BoardCard) => void;
  isBusy: boolean;
}

function Shelf({ title, empty, cards, at, cardHref, onRestore, isBusy }: ShelfProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const headingId = useId();
  const newestFirst = [...cards].sort((left, right) =>
    (at(right) ?? '').localeCompare(at(left) ?? ''),
  );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-sm font-semibold">
        {title} <span className="text-muted-foreground tabular-nums">{cards.length}</span>
      </h2>
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {newestFirst.map((card) => {
            const when = at(card);
            const place = cardPlace(card);
            return (
              <li key={card.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={cardHref(card.id)}
                    scroll={false}
                    className="font-medium break-words hover:underline"
                  >
                    {card.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {[place, when === null ? null : formatDateTime(when, language)]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </span>
                </div>
                {onRestore === undefined ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={isBusy}
                    onClick={() => onRestore(card)}
                  >
                    {t('boards.restoreCard')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
