import {
  BOARD_LIMITS,
  boardSummary,
  EMPTY_CARD_FILTERS,
  hasCardFilters,
  liveColumns,
  localDay,
  matchesCardFilters,
  orderCards,
  type CardFilters,
  type CardOrder,
} from '@str-ops/shared';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ChoiceChips } from '@/components/choice-chips';
import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { FailureText } from '@/components/failure-text';
import { IconButton } from '@/components/icon-button';
import { ListRow } from '@/components/list-row';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Toast } from '@/components/toast';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useStaffDirectory } from '@/features/board/use-board';
import { serverErrorText } from '@/lib/server-error';

import { BoardCardRow } from './board-card-row';
import { ActionsSheet, ArchivedBoardsSheet, BoardNameSheet, FiltersSheet } from './board-sheets';
import { ARCHIVE_PANE, boardLanes, columnLabel, laneIdOf, paneOf } from './columns';
import { ColumnsSheet } from './columns-sheet';
import { MyCardsBody } from './my-cards-body';
import {
  assignablePeople,
  canEditBoard,
  canWorkOn,
  shelfOf,
  type Board,
  type BoardCard,
  type BoardViewer,
  type ColumnRow,
} from './schema';
import { TransferSheet } from './transfer-sheet';
import {
  useBoardCards,
  useBoardColumns,
  useBoards,
  useMyCards,
  useSaveCard,
  useSetBoardArchived,
  useSetCardShelf,
  useViewer,
} from './use-boards';

/** The switcher's value of «Назначено мне», in place of a board's id. */
const MY_CARDS = 'mine';

interface BoardsTabProps {
  /** A board asked for from outside — a tap on «Вам передана доска» (push/destination.ts). */
  requestedBoardId?: string;
  /** The ask is taken: the route forgets it, so the same ask can come again later. */
  onRequestSeen?: () => void;
}

/**
 * The office's «Доски» on the phone (docs/manager-boards.md): «Назначено мне»
 * and the boards one tap each, then the chosen board — what is late, the
 * search, a column at a time (several on a phone's width would be unreadable),
 * a quick add on top of it, and the archive. A card opens on its own screen.
 */
export function BoardsTab({ requestedBoardId, onRequestSeen }: BoardsTabProps = {}) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const viewer = useViewer();
  const boards = useBoards();
  const mine = useMyCards();
  const [chosenId, setChosenId] = useState<string | null>(requestedBoardId ?? null);
  const [sheet, setSheet] = useState<'create' | 'archived' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seenRequest, setSeenRequest] = useState(requestedBoardId);
  if (requestedBoardId !== seenRequest) {
    // A new ask from outside, the tab already open: its board is shown, once per ask.
    setSeenRequest(requestedBoardId);
    if (requestedBoardId !== undefined) {
      setChosenId(requestedBoardId);
    }
  }
  useEffect(() => {
    if (requestedBoardId !== undefined) {
      onRequestSeen?.();
    }
  }, [requestedBoardId, onRequestSeen]);

  // Only boards never read show the failure: a refresh that fails keeps the ones read before.
  if (boards.data === undefined) {
    return boards.isError ? (
      <ErrorState
        error={boards.error}
        title={t('boards.loadError')}
        onRetry={() => void boards.refetch()}
      />
    ) : (
      <LoadingState label={t('boards.loading')} />
    );
  }
  const all = boards.data;
  const live = all.filter((board) => board.archived_at === null);
  const archived = all.filter((board) => board.archived_at !== null);
  const board =
    chosenId === MY_CARDS ? null : (all.find((one) => one.id === chosenId) ?? live[0] ?? null);
  const toast = <Toast message={notice} onHide={() => setNotice(null)} />;

  const onTransferred = (handed: Board, ownerName: string) => {
    setNotice(t('boards.transferDone', { name: ownerName }));
    // A board she alone saw leaves her list with it (an admin sees every board): the next one is
    // shown — or «Назначено мне» — rather than one she can no longer open.
    if (!handed.shared && !viewer.isAdmin) {
      setChosenId(live.find((one) => one.id !== handed.id)?.id ?? MY_CARDS);
    }
  };

  const sheets = (
    <>
      <BoardNameSheet
        isVisible={sheet === 'create'}
        onClose={() => setSheet(null)}
        onSaved={(boardId) => {
          setSheet(null);
          setChosenId(boardId);
        }}
      />
      <ArchivedBoardsSheet
        isVisible={sheet === 'archived'}
        boards={archived}
        onClose={() => setSheet(null)}
        onChoose={(boardId) => {
          setSheet(null);
          setChosenId(boardId);
        }}
      />
    </>
  );

  // No board to show and nothing given to her: the way to a first board. Cards given to her on
  // boards she does not see still show under «Назначено мне».
  if (board === null && live.length === 0 && (mine.data ?? []).length === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title={t('boards.switcherLabel')}
          message={t('boards.noBoards')}
          action={{ label: t('boards.newBoard'), onPress: () => setSheet('create') }}
        />
        {archived.length === 0 ? null : (
          <Button
            label={t('boards.archivedBoards')}
            variant="outline"
            onPress={() => setSheet('archived')}
          />
        )}
        {sheets}
        {toast}
      </View>
    );
  }

  const switcher = [
    { value: MY_CARDS, label: t('boards.assignedToMe') },
    ...live.map((one) => ({ value: one.id, label: one.title })),
    ...(board === null || board.archived_at === null
      ? []
      : [{ value: board.id, label: board.title }]),
  ];

  return (
    <View style={styles.screen}>
      <View style={styles.switcher}>
        <View style={styles.chips}>
          <ChoiceChips
            options={switcher}
            value={board === null ? MY_CARDS : board.id}
            onChange={setChosenId}
            accessibilityLabel={t('boards.switcherLabel')}
            semantics="tabs"
          />
        </View>
        <IconButton
          icon="action.add"
          accessibilityLabel={t('boards.newBoard')}
          onPress={() => setSheet('create')}
        />
        {archived.length === 0 ? null : (
          <IconButton
            icon="status.archived"
            accessibilityLabel={t('boards.archivedBoards')}
            onPress={() => setSheet('archived')}
          />
        )}
      </View>
      {board === null ? (
        <MyCardsBody />
      ) : (
        <BoardBody key={board.id} board={board} viewer={viewer} onTransferred={onTransferred} />
      )}
      {sheets}
      {toast}
    </View>
  );
}

interface BoardBodyProps {
  board: Board;
  viewer: BoardViewer;
  /** Handed to another owner: the board, and the new owner's name. */
  onTransferred?: (board: Board, ownerName: string) => void;
}

type BoardSheet = 'filters' | 'menu' | 'settings' | 'columns' | 'transfer';

/** One board under the switcher; exported for its tests (an archived board, read by everybody). */
export function BoardBody({ board, viewer, onTransferred }: BoardBodyProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const cards = useBoardCards(board.id);
  const columns = useBoardColumns(board.id);
  const staff = useStaffDirectory();
  const shelve = useSetCardShelf();
  const archiveBoard = useSetBoardArchived();
  const [chosenPane, setPane] = useState<string | null>(null);
  const [filters, setFilters] = useState<CardFilters>(EMPTY_CARD_FILTERS);
  const [order, setOrder] = useState<CardOrder>('due');
  const [sheet, setSheet] = useState<BoardSheet | null>(null);
  const today = localDay();
  // The board itself: its owner and an admin. Its cards: everybody in the office, on a live board.
  const canEdit = canEditBoard(board, viewer);
  const canWork = canWorkOn(board);
  const mayRestore = board.archived_at !== null && (viewer.isAdmin || board.owner_id === viewer.id);

  const all = cards.data ?? [];
  // Until the board's columns are read — its first open after the update, without signal — its
  // cards stand by their stage in the four panes of before; a card is made in a column only.
  const live = columns.data === undefined ? null : liveColumns(columns.data);
  const lanes = boardLanes(live, t);
  const pane = paneOf(chosenPane, lanes);
  const paneColumn = lanes.find((lane) => lane.id === pane)?.column ?? null;
  const inLane = (card: BoardCard, laneId: string) => laneIdOf(card, live) === laneId;
  const matching = all.filter((card) => matchesCardFilters(card, filters, today));
  const onBoard = matching.filter((card) => shelfOf(card) === 'active');
  const offBoard = matching.filter((card) => shelfOf(card) !== 'active');
  const summary = boardSummary(
    all.filter((card) => shelfOf(card) === 'active'),
    today,
  );
  const panes = [
    ...lanes.map((lane) => ({
      value: lane.id,
      label: `${lane.label} ${onBoard.filter((card) => inLane(card, lane.id)).length}`,
    })),
    { value: ARCHIVE_PANE, label: `${t('boards.viewArchive')} ${offBoard.length}` },
  ];
  const shown =
    pane === ARCHIVE_PANE
      ? offBoard
      : pane === null
        ? []
        : orderCards(
            onBoard.filter((card) => inLane(card, pane)),
            order,
          );
  const failure = [shelve, archiveBoard].find((mutation) => mutation.isError);
  const columnsFailure = live === null && columns.isError ? columns.error : null;
  const open = (cardId: string) =>
    router.push({ pathname: '/board-card/[id]', params: { id: cardId } });

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          <Text variant="heading">{board.title}</Text>
          <Text variant="caption" tone="secondary">
            {t('boards.owner', { name: board.owner?.full_name ?? t('boards.unknownPerson') })}
          </Text>
        </View>
        {canEdit ? (
          <IconButton
            icon="action.more"
            accessibilityLabel={t('boards.boardMenu')}
            onPress={() => setSheet('menu')}
          />
        ) : null}
      </View>
      {board.archived_at !== null ? (
        <View style={styles.note}>
          <Text>{t('boards.boardArchived')}</Text>
          {mayRestore ? (
            <Button
              label={t('boards.restoreBoard')}
              isBusy={archiveBoard.isPending}
              onPress={() => archiveBoard.mutate({ boardId: board.id, archived: false })}
            />
          ) : null}
        </View>
      ) : null}
      <View style={styles.summary}>
        <Button
          label={t('boards.summary.overdue', { count: summary.overdue })}
          variant="outline"
          onPress={() => setFilters({ ...filters, due: 'overdue' })}
        />
        <Button
          label={t('boards.summary.today', { count: summary.today })}
          variant="outline"
          onPress={() => setFilters({ ...filters, due: 'today' })}
        />
      </View>
      <Text variant="caption" tone="secondary">
        {t('boards.summary.open', { count: summary.open })}
      </Text>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <TextField
            label={t('boards.search')}
            value={filters.query}
            onChangeText={(query) => setFilters({ ...filters, query })}
          />
        </View>
        <IconButton
          icon="action.search"
          accessibilityLabel={t('boards.filters.label')}
          onPress={() => setSheet('filters')}
        />
      </View>
      <ChoiceChips
        options={panes}
        value={pane ?? ''}
        onChange={setPane}
        accessibilityLabel={t('boards.column')}
        semantics="tabs"
      />
      {columnsFailure === null ? null : (
        <ErrorBanner title={t('boards.staleNote')} error={columnsFailure} />
      )}
      {canWork && paneColumn !== null ? <QuickAdd boardId={board.id} column={paneColumn} /> : null}
      {failure === undefined ? null : <FailureText error={failure.error} />}
    </View>
  );

  return (
    <>
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={shown}
        keyExtractor={(card) => card.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={cards.isRefetching}
            onRefresh={() => {
              void cards.refetch();
              void columns.refetch();
            }}
          />
        }
        renderItem={({ item }) =>
          pane === ARCHIVE_PANE ? (
            <ShelvedRow
              card={item}
              canRestore={canWork}
              isBusy={shelve.isPending}
              onOpen={open}
              onRestore={() => shelve.mutate({ cardId: item.id, shelf: 'active' })}
            />
          ) : (
            <BoardCardRow card={item} today={today} onPress={open} />
          )
        }
        ListEmptyComponent={
          cards.isPending ? (
            <LoadingState label={t('boards.loading')} />
          ) : cards.isError ? (
            <ErrorState error={cards.error} title={t('boards.loadError')} />
          ) : (
            <Text tone="secondary" align="center">
              {pane === ARCHIVE_PANE
                ? t('boards.archiveEmpty')
                : hasCardFilters(filters)
                  ? t('boards.columnEmptyFiltered')
                  : t('boards.columnEmpty')}
            </Text>
          )
        }
      />
      <FiltersSheet
        isVisible={sheet === 'filters'}
        onClose={() => setSheet(null)}
        filters={filters}
        onChange={setFilters}
        order={order}
        onOrderChange={setOrder}
        people={assignablePeople(staff.data ?? [])}
        viewerId={viewer.id}
      />
      <ActionsSheet
        isVisible={sheet === 'menu'}
        title={t('boards.boardMenu')}
        onClose={() => setSheet(null)}
        actions={[
          { label: t('boards.settingsTitle'), onPress: () => setSheet('settings') },
          { label: t('boards.columns'), onPress: () => setSheet('columns') },
          { label: t('boards.transfer'), onPress: () => setSheet('transfer') },
          {
            label: t('boards.archiveBoard'),
            isDestructive: true,
            onPress: () => archiveBoard.mutate({ boardId: board.id, archived: true }),
          },
        ]}
      />
      <BoardNameSheet
        isVisible={sheet === 'settings'}
        board={board}
        viewer={viewer}
        onClose={() => setSheet(null)}
        onSaved={() => setSheet(null)}
      />
      <ColumnsSheet
        isVisible={sheet === 'columns'}
        board={board}
        columns={columns.data ?? []}
        cards={all}
        onClose={() => setSheet(null)}
      />
      <TransferSheet
        isVisible={sheet === 'transfer'}
        board={board}
        viewer={viewer}
        onClose={() => setSheet(null)}
        onTransferred={(ownerName) => {
          setSheet(null);
          onTransferred?.(board, ownerName);
        }}
      />
    </>
  );
}

/** The quickest way onto a column: the title, then «Готово» on the keyboard. */
function QuickAdd({ boardId, column }: { boardId: string; column: ColumnRow }) {
  const { t } = useTranslation();
  const save = useSaveCard();
  const [title, setTitle] = useState('');
  // One id per attempt — the same column and words: a repeat after a lost answer is the same
  // card, and a changed title or column is a new card, not an answer of the old one.
  const attempt = useRef<{ key: string; cardId: string } | null>(null);
  const failure = save.isError ? serverErrorText(save.error).text : null;

  const submit = () => {
    const words = title.trim();
    if (words === '' || save.isPending) {
      return;
    }
    const key = `${column.id}\n${words}`;
    const cardId = attempt.current?.key === key ? attempt.current.cardId : randomUUID();
    attempt.current = { key, cardId };
    save.mutate(
      {
        cardId,
        boardId,
        columnId: column.id,
        fields: { title: words, description: '', dueOn: null, propertyId: null, color: null },
      },
      {
        onSuccess: () => {
          setTitle((now) => (now.trim() === words ? '' : now));
          attempt.current = null;
        },
      },
    );
  };

  return (
    <TextField
      label={t('boards.quickAddLabel', { column: columnLabel(column, t) })}
      value={title}
      onChangeText={setTitle}
      maxLength={BOARD_LIMITS.cardTitle}
      placeholder={t('boards.quickAdd')}
      returnKeyType="done"
      onSubmitEditing={submit}
      isDisabled={save.isPending}
      error={failure}
    />
  );
}

function ShelvedRow({
  card,
  canRestore,
  isBusy,
  onOpen,
  onRestore,
}: {
  card: BoardCard;
  canRestore: boolean;
  isBusy: boolean;
  onOpen: (cardId: string) => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  const shelf = shelfOf(card);
  // The row and «Вернуть» side by side, not one inside the other: a screen reader reaches both.
  return (
    <View style={shelvedStyles.row}>
      <View style={shelvedStyles.title}>
        <ListRow
          title={card.title}
          subtitle={shelf === 'deleted' ? t('boards.deletedCards') : t('boards.archivedCards')}
          onPress={() => onOpen(card.id)}
        />
      </View>
      {canRestore ? (
        <Button
          label={t('boards.restoreCard')}
          variant="outline"
          isBusy={isBusy}
          onPress={onRestore}
        />
      ) : null}
    </View>
  );
}

const shelvedStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flex: 1 },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    switcher: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
    },
    chips: { flex: 1 },
    list: { padding: Spacing.md, gap: Spacing.sm },
    header: { gap: Spacing.sm, marginBottom: Spacing.sm },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    titleText: { flex: 1 },
    note: {
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.card,
      backgroundColor: theme.surfaceAlt,
    },
    summary: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs },
    search: { flex: 1 },
  });
