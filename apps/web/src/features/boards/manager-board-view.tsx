'use client';

import {
  BOARD_LIMITS,
  boardSummary,
  EMPTY_CARD_FILTERS,
  hasCardFilters,
  matchesCardFilters,
  type CardFilters,
  type CardOrder,
  type DueFilter,
} from '@str-ops/shared';
import { Ellipsis, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmMoveDialog } from '@/features/problems/board-dialogs';
import { todayIso } from '@/lib/format-date';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';
import { useAddressState } from '@/lib/use-address-state';

import { readBoardAddress, writeBoardAddress, type BoardShelfView } from './address';
import { BoardArchive } from './board-archive';
import { BoardFilters } from './board-filters';
import { BoardNameDialog } from './board-name-dialog';
import { CardDialog } from './card-dialog';
import type { CardActions } from './card-tile';
import { ManagerBoard } from './manager-board';
import { boardKeys } from './keys';
import { NewCardDialog } from './new-card-dialog';
import {
  assignablePeople,
  canEditBoard,
  canWorkOn,
  shelfOf,
  type Board,
  type BoardCard,
  type BoardViewer,
  type CardShelf,
} from './schema';
import {
  useBoardCards,
  useBoards,
  useDuplicateCard,
  useMoveCard,
  useOfficePeople,
  useSetBoardArchived,
  useSetCardShelf,
} from './use-boards';

interface ManagerBoardViewProps {
  boardId: string;
  viewer: BoardViewer;
}

/**
 * A manager board in «Задания» (docs/manager-boards.md): its name and owner,
 * what is late and what is due today, the search and the filters, the four
 * columns, and the archive. The owner and an admin change it; a card's assignee
 * works on that card; another manager reads the rest, and the page says so.
 */
export function ManagerBoardView({ boardId, viewer }: ManagerBoardViewProps) {
  const { t } = useTranslation();
  const boards = useBoards();
  const cards = useBoardCards(boardId);

  // A read that failed while the board was already on screen (a refresh after a write, a
  // window focused again) leaves the board as it is — with its drafts, filters and dialogs —
  // and says so under it; only a board never read shows the failure instead.
  if (boards.data === undefined || cards.data === undefined) {
    return boards.isError || cards.isError ? (
      <ErrorState message={t('boards.loadError')} error={boards.error ?? cards.error} />
    ) : (
      <LoadingState>{t('boards.loading')}</LoadingState>
    );
  }
  const board = boards.data.find((candidate) => candidate.id === boardId);
  if (board === undefined && boards.isFetching) {
    // A board just made: the list that names it is on its way.
    return <LoadingState>{t('boards.loading')}</LoadingState>;
  }
  if (board === undefined) {
    return <EmptyState>{t('serverErrors.boardNotFound')}</EmptyState>;
  }
  return (
    <BoardPage
      board={board}
      cards={cards.data}
      viewer={viewer}
      isStale={boards.isError || cards.isError}
    />
  );
}

/** What the line under the board says after a card left it: with «Отменить». */
interface Shelved {
  card: Pick<BoardCard, 'id' | 'title'>;
  shelf: CardShelf;
}

function BoardPage({
  board,
  cards,
  viewer,
  isStale,
}: {
  board: Board;
  cards: readonly BoardCard[];
  viewer: BoardViewer;
  /** The last read failed: what shows is the read before it. */
  isStale: boolean;
}) {
  const { t } = useTranslation();
  const [address, setAddress] = useAddressState(readBoardAddress, writeBoardAddress);
  // The latest failure only: an older one never hides the line of a later success.
  const [failure, setFailure] = useState<ServerErrorText | null>(null);
  // A card opened from this page was pushed onto the history: closing it goes back.
  const openedHere = useRef(false);
  // Closed by «Назад» in the browser: the next close has no entry of ours to go back over.
  useEffect(() => {
    if (address.cardId === null) {
      openedHere.current = false;
    }
  }, [address.cardId]);
  // The copy each card's «Дублировать» is making: a repeat after a lost answer is the same copy.
  const copies = useRef(new Map<string, string>());
  const [filters, setFilters] = useState<CardFilters>(EMPTY_CARD_FILTERS);
  const [order, setOrder] = useState<CardOrder>('due');
  const [isCreating, setIsCreating] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [shelved, setShelved] = useState<Shelved | null>(null);
  const move = useMoveCard(boardKeys.cards(board.id));
  const shelve = useSetCardShelf();
  const duplicate = useDuplicateCard();
  const archiveBoard = useSetBoardArchived();
  const people = useOfficePeople();

  const today = todayIso();
  const canEdit = canEditBoard(board, viewer);
  const mayRestoreBoard =
    board.archived_at !== null && (viewer.isAdmin || board.owner_id === viewer.id);
  const isFiltered = hasCardFilters(filters);
  const matching = cards.filter((card) => matchesCardFilters(card, filters, today));
  const onBoard = matching.filter((card) => shelfOf(card) === 'active');
  const offBoard = matching.filter((card) => shelfOf(card) !== 'active');
  const summary = boardSummary(
    cards.filter((card) => shelfOf(card) === 'active'),
    today,
  );

  const here = { boardId: board.id, view: address.view, cardId: null };
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
  /** A write's own outcome: its refusal replaces any older one, its success clears it. */
  const outcome = (onSuccess?: () => void) => ({
    onSuccess: () => {
      setFailure(null);
      onSuccess?.();
    },
    onError: (error: unknown) => setFailure(serverErrorText(error)),
  });

  const putOn = (card: Pick<BoardCard, 'id' | 'title'>, shelf: CardShelf) => {
    setShelved(null);
    shelve.mutate(
      { cardId: card.id, shelf },
      outcome(() => setShelved(shelf === 'active' ? null : { card, shelf })),
    );
  };

  const copy = (card: BoardCard) => {
    if (duplicate.isPending) {
      return;
    }
    const cardId = copies.current.get(card.id) ?? crypto.randomUUID();
    copies.current.set(card.id, cardId);
    const title = t('boards.copyTitle', { title: card.title }).slice(0, BOARD_LIMITS.cardTitle);
    duplicate.mutate(
      { sourceId: card.id, cardId, title },
      outcome(() => {
        copies.current.delete(card.id);
        openCard(cardId);
      }),
    );
  };

  const moveIt = (card: BoardCard, column: BoardCard['column_key']) => {
    setShelved(null);
    move.mutate({ cardId: card.id, column }, outcome());
  };
  // The owner and an admin: everything; a card's assignee: its moves; anybody else: nothing.
  const actionsFor = (card: BoardCard): CardActions | undefined => {
    if (canEdit) {
      return { onMove: moveIt, onDuplicate: copy, onShelve: putOn };
    }
    return canWorkOn(board, card, viewer) ? { onMove: moveIt } : undefined;
  };
  const worksOnAny = canEdit || onBoard.some((card) => canWorkOn(board, card, viewer));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={board.title}
        description={t('boards.owner', {
          name: board.owner?.full_name ?? t('boards.unknownPerson'),
        })}
        actions={
          <>
            <Input
              type="search"
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              placeholder={t('boards.search')}
              aria-label={t('boards.search')}
              className="h-11 w-full sm:w-64"
            />
            {canEdit ? (
              <Button type="button" className="h-11 px-4" onClick={() => setIsCreating(true)}>
                <Plus aria-hidden="true" />
                {t('boards.addCard')}
              </Button>
            ) : null}
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button type="button" variant="outline" className="size-11" />}
                  aria-label={t('boards.boardMenu')}
                >
                  <Ellipsis aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                    {t('boards.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsArchiving(true)}>
                    {t('boards.archiveBoard')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      {board.archived_at !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
          <span>{t('boards.boardArchivedNote')}</span>
          {mayRestoreBoard ? (
            <Button
              type="button"
              className="h-11"
              disabled={archiveBoard.isPending}
              onClick={() => archiveBoard.mutate({ boardId: board.id, archived: false }, outcome())}
            >
              {t('boards.restoreBoard')}
            </Button>
          ) : null}
        </div>
      ) : canEdit ? null : (
        <p className="rounded-lg bg-muted p-3 text-sm">{t('boards.readOnly')}</p>
      )}

      <SummaryLine summary={summary} onPick={(due) => setFilters({ ...filters, due })} />
      <BoardFilters
        filters={filters}
        onChange={setFilters}
        order={order}
        onOrderChange={setOrder}
        people={assignablePeople(people.data ?? [])}
        viewerId={viewer.id}
      />

      <Tabs
        value={address.view}
        onValueChange={(value) => setAddress({ ...here, view: value as BoardShelfView }, 'push')}
      >
        <TabsList className="h-auto">
          <TabsTrigger value="board" className="min-h-11 px-3">
            {t('boards.viewBoard')}
          </TabsTrigger>
          <TabsTrigger value="archive" className="min-h-11 px-3">
            {t('boards.viewArchive')}
            <span className="ml-1 text-xs text-muted-foreground">{offBoard.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="board">
          <ManagerBoard
            boardId={board.id}
            cards={onBoard}
            order={order}
            today={today}
            isFiltered={isFiltered}
            actionsFor={actionsFor}
            canAdd={canEdit}
            cardHref={cardHref}
            onOpen={openCard}
          />
        </TabsContent>
        <TabsContent value="archive">
          <BoardArchive
            cards={offBoard}
            cardHref={cardHref}
            onOpen={openCard}
            onRestore={canEdit ? (card) => putOn(card, 'active') : undefined}
            isBusy={shelve.isPending}
          />
        </TabsContent>
      </Tabs>

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
              onClick={() => putOn(shelved.card, 'active')}
            >
              {t('boards.undo')}
            </Button>
          </span>
        ) : isStale ? (
          t('boards.staleNote')
        ) : worksOnAny ? (
          t('boards.dragHint')
        ) : null}
      </p>

      {address.cardId === null ? null : (
        <CardDialog
          key={address.cardId}
          cardId={address.cardId}
          board={board}
          viewer={viewer}
          today={today}
          onClose={closeCard}
          onShelved={(card, shelf) => {
            closeCard();
            setShelved(shelf === 'active' ? null : { card, shelf });
          }}
          onDuplicated={openCard}
        />
      )}
      {isCreating ? (
        <NewCardDialog
          boardId={board.id}
          ownerId={board.owner_id}
          onClose={() => setIsCreating(false)}
          onCreated={(cardId) => {
            setIsCreating(false);
            openCard(cardId);
          }}
        />
      ) : null}
      {isRenaming ? (
        <BoardNameDialog
          board={board}
          onClose={() => setIsRenaming(false)}
          onSaved={() => setIsRenaming(false)}
        />
      ) : null}
      <ConfirmMoveDialog
        open={isArchiving}
        title={t('boards.archiveBoard')}
        description={t('boards.archiveBoardText', { title: board.title })}
        confirmLabel={t('boards.archiveBoard')}
        abortLabel={t('boards.cancel')}
        isBusy={archiveBoard.isPending}
        onConfirm={() =>
          archiveBoard.mutate(
            { boardId: board.id, archived: true },
            { ...outcome(), onSettled: () => setIsArchiving(false) },
          )
        }
        onClose={() => setIsArchiving(false)}
      />
    </div>
  );
}

/**
 * The line above the board: what is late, what is due today, how many cards
 * are open. A late or a today count narrows the board to those cards.
 */
function SummaryLine({
  summary,
  onPick,
}: {
  summary: ReturnType<typeof boardSummary>;
  onPick: (due: DueFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Button
        type="button"
        variant="ghost"
        className={summary.overdue > 0 ? 'h-11 text-tone-overdue-fg' : 'h-11'}
        onClick={() => onPick('overdue')}
      >
        {t('boards.summary.overdue', { count: summary.overdue })}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={summary.today > 0 ? 'h-11 text-tone-today-fg' : 'h-11'}
        onClick={() => onPick('today')}
      >
        {t('boards.summary.today', { count: summary.today })}
      </Button>
      <span className="px-2 text-muted-foreground">
        {t('boards.summary.open', { count: summary.open })}
      </span>
    </div>
  );
}
