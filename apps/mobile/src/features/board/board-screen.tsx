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
import { useBoardProblems, useStaffDirectory } from './use-board';

const NO_IDS: readonly string[] = [];

/** «Все»: every task out of the archive — nothing he has to look for is hidden at first. */
const FIRST_STATUS: BoardStatusFilter = 'all';

/**
 * The head technician's «Задания» (docs/tech-plan.md §3.4, §4; brief, item 1):
 * every task of the company, filtered by status and by who holds its live
 * repair. The filters live while the tab does; a task opens on its own screen,
 * where he hands it out or takes the person off.
 */
export function BoardScreen() {
  const { t } = useTranslation();
  const board = useBoardProblems();
  const staff = useStaffDirectory();
  const [status, setStatus] = useState<BoardStatusFilter>(FIRST_STATUS);
  const [assignee, setAssignee] = useState<AssigneeFilter>(ANY_ASSIGNEE);
  const [isPicking, setPicking] = useState(false);

  const names = useMemo(() => staffNames(staff.data, t), [staff.data, t]);
  const technicians = useMemo(() => activeTechnicians(staff.data ?? []), [staff.data]);
  const shown = useMemo(
    () => (board.data === undefined ? undefined : filterBoard(board.data, { status, assignee })),
    [board.data, status, assignee],
  );
  const sections = useMemo(() => (shown === undefined ? undefined : boardSections(shown)), [shown]);

  // The marks are asked for exactly the tasks on screen.
  const problemIds = useMemo(
    () => (shown === undefined ? NO_IDS : shown.map((problem) => problem.id)),
    [shown],
  );
  const unread = useUnreadSubjects(NO_IDS, problemIds);

  const { refetch: refetchBoard } = board;
  const { refetch: refetchStaff } = staff;
  const onRefresh = useCallback(() => {
    void refetchBoard();
    void refetchStaff();
    unread.refetch();
  }, [refetchBoard, refetchStaff, unread]);

  const onPress = useCallback((problemId: string) => {
    router.push({ pathname: '/problem/[id]', params: { id: problemId } });
  }, []);

  const onPickAssignee = useCallback((next: AssigneeFilter) => {
    setAssignee(next);
    setPicking(false);
  }, []);

  const isFiltered = status !== FIRST_STATUS || assignee.kind !== ANY_ASSIGNEE.kind;
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
        assignee={assignee}
        names={names}
        onPickAssignee={() => setPicking(true)}
      />
      <BoardList
        sections={sections}
        names={names}
        isLoading={board.isPending}
        // The names failing leaves neutral words on the cards: said, not hidden.
        error={board.error ?? staff.error ?? null}
        onRefresh={onRefresh}
        isRefreshing={board.isRefetching}
        onPress={onPress}
        unreadProblemIds={unread.problems}
        empty={empty}
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
