'use client';

import {
  EMPTY_CARD_FILTERS,
  hasCardFilters,
  matchesCardFilters,
  type BoardColumn,
  type CardFilters,
  type CardOrder,
} from '@str-ops/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { todayIso } from '@/lib/format-date';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';
import { useAddressState } from '@/lib/use-address-state';

import { MY_CARDS, readBoardAddress, writeBoardAddress } from './address';
import { BoardFilters } from './board-filters';
import { CardDialog } from './card-dialog';
import { boardKeys } from './keys';
import { ManagerBoard } from './manager-board';
import type { BoardCard, BoardViewer, CardShelf, MyCard } from './schema';
import { useBoards, useCard, useMoveCard, useMyCards, useSetCardShelf } from './use-boards';

interface MyCardsViewProps {
  viewer: BoardViewer;
}

/**
 * «Назначено мне» (owner, 2026-11-18): the cards the viewer is the assignee of, from every board
 * that is not archived, in the same four columns — each tile names its board. They are worked on
 * here as on their boards: moved, opened, copied and shelved (a copy opens; a shelved card leaves a
 * line with «Отменить»); a new card is made on a board.
 */
export function MyCardsView({ viewer }: MyCardsViewProps) {
  const { t } = useTranslation();
  const cards = useMyCards(viewer.id);
  const boards = useBoards();

  if (cards.data === undefined || boards.data === undefined) {
    return cards.isError || boards.isError ? (
      <ErrorState message={t('boards.loadError')} error={cards.error ?? boards.error} />
    ) : (
      <LoadingState>{t('boards.loading')}</LoadingState>
    );
  }
  return (
    <MyCardsPage
      cards={cards.data}
      boards={boards.data}
      viewer={viewer}
      isStale={cards.isError || boards.isError}
    />
  );
}

function MyCardsPage({
  cards,
  boards,
  viewer,
  isStale,
}: {
  cards: readonly MyCard[];
  boards: NonNullable<ReturnType<typeof useBoards>['data']>;
  viewer: BoardViewer;
  isStale: boolean;
}) {
  const { t } = useTranslation();
  const [address, setAddress] = useAddressState(readBoardAddress, writeBoardAddress);
  const [filters, setFilters] = useState<CardFilters>(EMPTY_CARD_FILTERS);
  const [order, setOrder] = useState<CardOrder>('due');
  const [failure, setFailure] = useState<ServerErrorText | null>(null);
  // The card open names its board itself: it stays open when it leaves the list (given away), and
  // a card opened by its address — a link, a reload — finds its board the same way.
  const opened = useCard(address.cardId);
  const openedHere = useRef(false);
  useEffect(() => {
    if (address.cardId === null) {
      openedHere.current = false;
    }
  }, [address.cardId]);
  const move = useMoveCard(boardKeys.mine(viewer.id));
  const shelve = useSetCardShelf();
  // A card that left the list from its dialog: the line says so, with «Отменить».
  const [shelved, setShelved] = useState<{
    card: Pick<BoardCard, 'id' | 'title'>;
    shelf: CardShelf;
  } | null>(null);

  const today = todayIso();
  const matching = cards.filter((card) => matchesCardFilters(card, filters, today));
  const here = { boardId: MY_CARDS, view: 'board' as const, cardId: null };
  const cardHref = (cardId: string) => `/problems?${writeBoardAddress({ ...here, cardId })}`;
  const openCard = (cardId: string) => {
    openedHere.current = true;
    setAddress({ ...here, cardId }, 'push');
  };
  const closeCard = () => {
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
      return;
    }
    setAddress({ ...here, cardId: null });
  };
  const moveIt = (card: BoardCard, column: BoardColumn) =>
    move.mutate(
      { cardId: card.id, column },
      {
        onSuccess: () => setFailure(null),
        onError: (error: unknown) => setFailure(serverErrorText(error)),
      },
    );

  const openBoard =
    address.cardId === null
      ? undefined
      : boards.find(
          (board) =>
            board.id ===
            (cards.find((card) => card.id === address.cardId)?.board_id ?? opened.data?.board_id),
        );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('boards.assignedToMe')}
        actions={
          <Input
            type="search"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder={t('boards.search')}
            aria-label={t('boards.search')}
            className="h-11 w-full sm:w-64"
          />
        }
      />
      <BoardFilters
        filters={filters}
        onChange={setFilters}
        order={order}
        onOrderChange={setOrder}
      />
      {cards.length === 0 ? (
        <EmptyState>{t('boards.assignedToMeEmpty')}</EmptyState>
      ) : (
        <ManagerBoard
          boardId=""
          cards={matching}
          order={order}
          today={today}
          isFiltered={hasCardFilters(filters)}
          actionsFor={() => ({ onMove: moveIt })}
          canAdd={false}
          cardHref={cardHref}
          onOpen={openCard}
          boardTitleOf={(card) => cards.find((mine) => mine.id === card.id)?.board.title ?? '—'}
        />
      )}
      <p role="status" aria-live="polite" className="min-h-11 text-sm text-muted-foreground">
        {failure !== null ? (
          <span className="text-destructive">
            {failure.text}
            {failure.detail === null ? '' : ` (${failure.detail})`}
          </span>
        ) : shelved !== null ? (
          <span className="flex flex-wrap items-center gap-2">
            {shelved.shelf === 'deleted' ? t('boards.cardDeleted') : t('boards.cardArchived')}
            {' · '}
            {shelved.card.title}
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={shelve.isPending}
              onClick={() =>
                shelve.mutate(
                  { cardId: shelved.card.id, shelf: 'active' },
                  {
                    onSuccess: () => setShelved(null),
                    onError: (error: unknown) => setFailure(serverErrorText(error)),
                  },
                )
              }
            >
              {t('boards.undo')}
            </Button>
          </span>
        ) : isStale ? (
          t('boards.staleNote')
        ) : null}
      </p>
      {address.cardId === null || openBoard === undefined ? null : (
        <CardDialog
          key={address.cardId}
          cardId={address.cardId}
          board={openBoard}
          viewer={viewer}
          today={today}
          listKey={boardKeys.mine(viewer.id)}
          onClose={closeCard}
          onShelved={(card, shelf) => {
            closeCard();
            setShelved(shelf === 'active' ? null : { card, shelf });
          }}
          onDuplicated={(cardId) => {
            // The copy is its board owner's, not in this list: it opens by its address, as on a board.
            openedHere.current = true;
            setAddress({ ...here, cardId }, 'push');
          }}
        />
      )}
    </div>
  );
}
