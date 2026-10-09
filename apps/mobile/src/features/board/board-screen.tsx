import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { EmptyStateProps } from '@/components/empty-state';
import { useUnreadSubjects } from '@/features/chat/use-chat';

import { AssigneeSheet, BoardFilters } from './board-filters';
import { BoardList } from './board-list';
import { staffNames } from './format';
import {
  ANY_ASSIGNEE,
  activeTechnicians,
  boardSections,
  filterBoard,
  type AssigneeFilter,
  type BoardStatusFilter,
} from './schema';
import { useBoardArchive, useBoardProblems, useStaffDirectory } from './use-board';

const NO_IDS: readonly string[] = [];

/** «Все»: every task out of the archive — nothing he has to look for is hidden at first. */
const FIRST_STATUS: BoardStatusFilter = 'all';

/**
 * The statuses whose tasks hold nobody: a resolved task's repair is done, and
 * archive_problem cancels the live one. A person filter there could only empty
 * the board, so it is set aside — kept for when he goes back.
 */
const HOLDS_NOBODY: ReadonlySet<BoardStatusFilter> = new Set(['resolved', 'archived']);

/**
 * The head technician's «Задания» (docs/tech-plan.md §3.4, §4; brief, item 1):
 * every task of the company, filtered by status and by who holds its live
 * repair. The board reads what is live and the last month's closed work; the
 * archive is read only when «Архив» is chosen, a page at a time (api.ts). The
 * filters live while the tab does; a task opens on its own screen, where he
 * hands it out or takes the person off.
 */
export function BoardScreen() {
  const { t } = useTranslation();
  const board = useBoardProblems();
  const [status, setStatus] = useState<BoardStatusFilter>(FIRST_STATUS);
  const isArchive = status === 'archived';
  const archive = useBoardArchive(isArchive);
  const staff = useStaffDirectory();
  const [assignee, setAssignee] = useState<AssigneeFilter>(ANY_ASSIGNEE);
  const [isPicking, setPicking] = useState(false);

  const isAssigneeOff = HOLDS_NOBODY.has(status);
  const shownAssignee = isAssigneeOff ? ANY_ASSIGNEE : assignee;
  const names = useMemo(() => staffNames(staff.data, t), [staff.data, t]);
  const technicians = useMemo(() => activeTechnicians(staff.data ?? []), [staff.data]);
  const rows = isArchive ? archive.data : board.data;
  const shown = useMemo(
    () => (rows === undefined ? undefined : filterBoard(rows, { status, assignee: shownAssignee })),
    [rows, status, shownAssignee],
  );
  const sections = useMemo(() => (shown === undefined ? undefined : boardSections(shown)), [shown]);

  // The marks are asked once for everything the phone holds — the board, and
  // the archive's pages once read — not for what the filters leave: a filter
  // is no new question to the server, and no task loses its mark under one.
  const problemIds = useMemo(
    () =>
      board.data === undefined && archive.data === undefined
        ? NO_IDS
        : [...(board.data ?? []), ...(archive.data ?? [])].map((problem) => problem.id),
    [board.data, archive.data],
  );
  const unread = useUnreadSubjects(NO_IDS, problemIds);

  const list = isArchive ? archive : board;
  const { refetch: refetchList } = list;
  const { refetch: refetchStaff } = staff;
  const onRefresh = useCallback(() => {
    void refetchList();
    void refetchStaff();
    unread.refetch();
  }, [refetchList, refetchStaff, unread]);

  const { fetchNextPage } = archive;
  const onLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const onPress = useCallback((problemId: string) => {
    router.push({ pathname: '/problem/[id]', params: { id: problemId } });
  }, []);

  const onPickAssignee = useCallback((next: AssigneeFilter) => {
    setAssignee(next);
    setPicking(false);
  }, []);

  const isFiltered = status !== FIRST_STATUS || shownAssignee.kind !== ANY_ASSIGNEE.kind;
  const empty: EmptyStateProps =
    isFiltered && (board.data?.length ?? 0) > 0
      ? {
          title: t('problems.board.emptyFiltered'),
          action: {
            label: t('problems.board.resetFilters'),
            onPress: () => {
              setStatus(FIRST_STATUS);
              setAssignee(ANY_ASSIGNEE);
            },
          },
        }
      : { title: t('problems.board.empty') };

  return (
    <View style={styles.screen}>
      <BoardFilters
        status={status}
        onStatusChange={setStatus}
        assignee={shownAssignee}
        isAssigneeOff={isAssigneeOff}
        names={names}
        onPickAssignee={() => setPicking(true)}
      />
      <BoardList
        sections={sections}
        names={names}
        isLoading={list.isPending}
        // The names failing leaves neutral words on the cards: said, not hidden.
        error={list.error ?? staff.error ?? null}
        onRefresh={onRefresh}
        // «Ещё» shows its own spinner; the pull's is for a refresh.
        isRefreshing={list.isRefetching && !(isArchive && archive.isFetchingNextPage)}
        onPress={onPress}
        unreadProblemIds={unread.problems}
        empty={empty}
        onLoadMore={isArchive && archive.hasNextPage ? onLoadMore : undefined}
        isLoadingMore={archive.isFetchingNextPage}
      />
      <AssigneeSheet
        isVisible={isPicking}
        value={assignee}
        technicians={technicians}
        names={names}
        onChange={onPickAssignee}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
