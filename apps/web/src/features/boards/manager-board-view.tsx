'use client';

import {
  BOARD_LIMITS,
  boardSummary,
  EMPTY_CARD_FILTERS,
  hasCardFilters,
  liveColumns,
  matchesCardFilters,
  type CardFilters,
  type CardOrder,
  type DueFilter,
} from '@str-ops/shared';
import { Ellipsis, Lock, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
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

import { boardHref, readBoardAddress, writeBoardAddress, type BoardShelfView } from './address';
import { BoardArchive } from './board-archive';
import { BoardFilters } from './board-filters';
import { BoardNameDialog } from './board-name-dialog';
import { CardDialog } from './card-dialog';
import type { CardActions } from './card-tile';
import { ColumnsDialog } from './columns-dialog';
import { boardKeys } from './keys';
import { columnLanes, laneOfCard, type PresetName } from './lanes';
import { ManagerBoard } from './manager-board';
import { NewCardDialog } from './new-card-dialog';
import { QuickAdd } from './quick-add';
import {
  assignablePeople,
  canEditBoard,
  canWorkOn,
  shelfOf,
  type Board,
  type BoardCard,
  type BoardViewer,
  type CardShelf,
  type ColumnRow,
} from './schema';
import { TransferDialog } from './transfer-dialog';
import {
  useBoardCards,
  useBoardColumns,
  useBoards,
  useDeleteArchivedBoard,
  useDeleteShelvedCard,
  useDuplicateCard,
  useForgetBoard,
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
 * A manager board in «Задания» (docs/manager-boards.md): its name, owner and
 * whether others see it, what is late and what is due today, the search and the
 * filters, its own columns (20261126120000), and the archive. Every manager and
 * admin who sees it works on its cards; the board itself — its name, who sees
 * it, its columns, its owner, its archive — is its owner's and an admin's, and
 * its menu is shown to them alone, without a word to anybody else. Only an
 * admin deletes for good what is in an archive (20261126150000): the archived
 * board, and an archived or deleted card — each after a question.
 */
export function ManagerBoardView({ boardId, viewer }: ManagerBoardViewProps) {
  const { t } = useTranslation();
  const boards = useBoards();
  const cards = useBoardCards(boardId);
  const columns = useBoardColumns(boardId);

  // A read that failed while the board was already on screen (a refresh after a write, a
  // window focused again) leaves the board as it is — with its drafts, filters and dialogs —
  // and says so under it; only a board never read shows the failure instead.
  if (boards.data === undefined || cards.data === undefined || columns.data === undefined) {
    return boards.isError || cards.isError || columns.isError ? (
      <ErrorState
        message={t('boards.loadError')}
        error={boards.error ?? cards.error ?? columns.error}
      />
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
      columns={columns.data}
      viewer={viewer}
      isStale={boards.isError || cards.isError || columns.isError}
    />
  );
}

/** What the line under the board says after a card left it: with «Отменить». */
interface Shelved {
  card: Pick<BoardCard, 'id' | 'title'>;
  shelf: CardShelf;
}

/** The board's own dialogs, one at a time: its owner's and an admin's («purge» an admin's alone). */
type BoardDialog = 'settings' | 'columns' | 'transfer' | 'archive' | 'purge';

interface BoardPageProps {
  board: Board;
  /** Every card of the board: on it, archived and deleted. */
  cards: readonly BoardCard[];
  /** Its columns, the deleted ones too. */
  columns: readonly ColumnRow[];
  viewer: BoardViewer;
  /** The last read failed: what shows is the read before it. */
  isStale: boolean;
}

function BoardPage({ board, cards, columns, viewer, isStale }: BoardPageProps) {
  const { t } = useTranslation();
  const router = useRouter();
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
  const [dialog, setDialog] = useState<BoardDialog | null>(null);
  const [shelved, setShelved] = useState<Shelved | null>(null);
  // «Доска передана: …» after a handover the viewer still sees the board after.
  const [notice, setNotice] = useState<string | null>(null);
  const move = useMoveCard(boardKeys.cards(board.id));
  const shelve = useSetCardShelf();
  const duplicate = useDuplicateCard();
  const archiveBoard = useSetBoardArchived();
  const people = useOfficePeople();
  const forgetBoard = useForgetBoard();
  const purgeBoard = useDeleteArchivedBoard();
  const purgeCard = useDeleteShelvedCard();
  // The card «Удалить навсегда» asks about; kept while its question fades out.
  const [purging, setPurging] = useState<BoardCard | null>(null);
  const [isPurgeAsked, setIsPurgeAsked] = useState(false);

  const today = todayIso();
  const presetName: PresetName = (key) => t(`problems.statuses.${key}`);
  const live = liveColumns(columns, board.id);
  const lanes = columnLanes(columns, board.id, presetName);
  // The board itself: its owner and an admin. Its cards: everybody in the office, on a live board.
  const canEdit = canEditBoard(board, viewer);
  const canWork = canWorkOn(board);
  const mayRestoreBoard =
    board.archived_at !== null && (viewer.isAdmin || board.owner_id === viewer.id);
  const mayPurgeBoard = board.archived_at !== null && viewer.isAdmin;
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
    setNotice(null);
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

  const moveIt = (card: BoardCard, lane: string) => {
    const target = live.find((column) => column.id === lane);
    if (target === undefined) {
      return;
    }
    setShelved(null);
    setNotice(null);
    move.mutate({ cardId: card.id, columnId: target.id, stage: target.legacy_key }, outcome());
  };
  const actionsFor = (): CardActions | undefined =>
    canWork ? { onMove: moveIt, onDuplicate: copy, onShelve: putOn } : undefined;

  // A private board handed over by its owner leaves his list: the technicians' board takes its
  // place, not «Доска не найдена». An admin, or the owner of a shared board, stays and is told.
  const transferred = (name: string) => {
    setDialog(null);
    if (!viewer.isAdmin && !board.shared) {
      forgetBoard(board.id);
      router.push(boardHref(null));
      return;
    }
    setShelved(null);
    setFailure(null);
    setNotice(t('boards.transferDone', { name }));
  };

  // An archived board deleted for good: it leaves the list at once and the technicians' board
  // takes its place, as after a handover of a private board.
  const purgeThisBoard = () =>
    purgeBoard.mutate(board.id, {
      ...outcome(() => {
        forgetBoard(board.id);
        router.push(boardHref(null));
      }),
      onSettled: () => setDialog(null),
    });

  const askPurgeCard = (card: BoardCard) => {
    setPurging(card);
    setIsPurgeAsked(true);
  };
  const purgeAskedCard = () => {
    if (purging === null) {
      return;
    }
    const { title } = purging;
    setShelved(null);
    setNotice(null);
    purgeCard.mutate(purging.id, {
      ...outcome(() => setNotice(`${t('boards.cardPurged')} · ${title}`)),
      onSettled: () => setIsPurgeAsked(false),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={board.title}
        meta={
          board.shared ? undefined : (
            <Badge variant="outline">
              <Lock aria-hidden="true" />
              {t('boards.privateBoard')}
            </Badge>
          )
        }
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
            {canWork ? (
              <Button type="button" className="h-11 px-4" onClick={() => setIsCreating(true)}>
                <Plus aria-hidden="true" />
                {t('boards.addCard')}
              </Button>
            ) : null}
            {canEdit ? <BoardMenu onPick={setDialog} /> : null}
          </>
        }
      />

      {board.archived_at !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
          <span>{t('boards.boardArchivedNote')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {mayRestoreBoard ? (
              <Button
                type="button"
                className="h-11"
                disabled={archiveBoard.isPending || purgeBoard.isPending}
                onClick={() =>
                  archiveBoard.mutate({ boardId: board.id, archived: false }, outcome())
                }
              >
                {t('boards.restoreBoard')}
              </Button>
            ) : null}
            {mayPurgeBoard ? (
              <Button
                type="button"
                variant="destructive"
                className="h-11"
                disabled={archiveBoard.isPending || purgeBoard.isPending}
                onClick={() => setDialog('purge')}
              >
                {t('boards.purgeBoard')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

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
            lanes={lanes}
            laneOf={(card) => laneOfCard(card, lanes)}
            cards={onBoard}
            order={order}
            today={today}
            isFiltered={isFiltered}
            actionsFor={actionsFor}
            footerOf={
              canWork
                ? (lane) => (
                    <QuickAdd boardId={board.id} columnId={lane.key} columnName={lane.name} />
                  )
                : undefined
            }
            cardHref={cardHref}
            onOpen={openCard}
          />
        </TabsContent>
        <TabsContent value="archive">
          <BoardArchive
            cards={offBoard}
            cardHref={cardHref}
            onOpen={openCard}
            onRestore={canWork ? (card) => putOn(card, 'active') : undefined}
            onPurge={viewer.isAdmin ? askPurgeCard : undefined}
            isBusy={shelve.isPending || purgeCard.isPending}
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
        ) : notice !== null ? (
          notice
        ) : isStale ? (
          t('boards.staleNote')
        ) : canWork ? (
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
          columns={lanes}
          onClose={() => setIsCreating(false)}
          onCreated={(cardId) => {
            setIsCreating(false);
            openCard(cardId);
          }}
        />
      ) : null}
      {dialog === 'settings' ? (
        <BoardNameDialog
          board={board}
          isOthersBoard={board.owner_id !== viewer.id}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'columns' ? (
        <ColumnsDialog
          board={board}
          columns={columns}
          cards={cards}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'transfer' ? (
        <TransferDialog
          board={board}
          viewer={viewer}
          onClose={() => setDialog(null)}
          onTransferred={transferred}
        />
      ) : null}
      <ConfirmMoveDialog
        open={dialog === 'archive'}
        title={t('boards.archiveBoard')}
        description={t('boards.archiveBoardText', { title: board.title })}
        confirmLabel={t('boards.archiveBoard')}
        abortLabel={t('boards.cancel')}
        isBusy={archiveBoard.isPending}
        onConfirm={() =>
          archiveBoard.mutate(
            { boardId: board.id, archived: true },
            { ...outcome(), onSettled: () => setDialog(null) },
          )
        }
        onClose={() => setDialog(null)}
      />
      <ConfirmMoveDialog
        open={dialog === 'purge'}
        title={t('boards.purgeBoard')}
        description={t('boards.purgeBoardText', { title: board.title })}
        confirmLabel={t('boards.purgeConfirm')}
        abortLabel={t('boards.cancel')}
        isDestructive
        isBusy={purgeBoard.isPending}
        onConfirm={purgeThisBoard}
        onClose={() => setDialog(null)}
      />
      <ConfirmMoveDialog
        open={isPurgeAsked}
        title={t('boards.purgeCardTitle')}
        description={t('boards.purgeCardText', { title: purging?.title ?? '' })}
        confirmLabel={t('boards.purgeConfirm')}
        abortLabel={t('boards.cancel')}
        isDestructive
        isBusy={purgeCard.isPending}
        onConfirm={purgeAskedCard}
        onClose={() => setIsPurgeAsked(false)}
      />
    </div>
  );
}

/**
 * The board's menu, for its owner and an admin on a live board: its settings (name, who sees it),
 * its columns, handing it over, and the archive.
 */
function BoardMenu({ onPick }: { onPick: (dialog: BoardDialog) => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" className="size-11" />}
        aria-label={t('boards.boardMenu')}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onPick('settings')}>
          {t('boards.settingsTitle')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick('columns')}>{t('boards.columns')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick('transfer')}>
          {t('boards.transfer')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick('archive')}>
          {t('boards.archiveBoard')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
