import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ActionBar } from '@/components/action-bar';
import { Button } from '@/components/button';
import { isOffice, isTechnician } from '@/features/auth/role';
import { useRole } from '@/features/auth/use-role';
import { BoardScreen } from '@/features/board/board-screen';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { ProblemList } from '@/features/problems/problem-list';
import { groupProblems, queueProblems } from '@/features/problems/schema';
import { useMyProblems } from '@/features/problems/use-problems';

const NO_IDS: readonly string[] = [];

/**
 * Her reports, with «Создать задание» pinned under them, above the tab bar:
 * as the first row of the list it scrolled away, and it was missing whenever
 * the list could not load — when she is offline, which is exactly when a
 * report has to wait in the queue.
 *
 * A technician has no listings to report on from here: he raises a task from
 * his repair, where its listing fills itself in (docs/tech-plan.md §4). He
 * gets the list without the button, in the queue's order (owner, 2026-11-26).
 *
 * The head technician's tab is not a list of his own at all: it is the board
 * of every task of the company, with its filters (docs/tech-plan.md §3.4, §4),
 * and no «Создать задание» either.
 *
 * The office — a manager, an admin — gets the same board (owner, 2026-11-18),
 * and keeps «Создать задание» under it, as it had on the phone before.
 */
export default function ProblemsScreen() {
  const role = useRole();

  if (role === 'head_tech') {
    return <BoardScreen />;
  }
  if (isOffice(role)) {
    return <OfficeBoard />;
  }
  // A technician's list is his queue (owner, 2026-11-26); a cleaner's, her reports newest first.
  const isTech = isTechnician(role);
  return <MyProblems canReport={!isTech} isQueue={isTech} />;
}

function OfficeBoard() {
  const { t } = useTranslation();

  return (
    <View style={styles.screen}>
      <BoardScreen />
      <ActionBar>
        <Button label={t('problems.report')} onPress={() => router.push('/problem/new')} />
      </ActionBar>
    </View>
  );
}

interface MyProblemsProps {
  canReport: boolean;
  /** The technician's queue order, with «Запланировано» (`queueProblems`). */
  isQueue: boolean;
}

function MyProblems({ canReport, isQueue }: MyProblemsProps) {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyProblems();

  const sections = useMemo(() => {
    if (data === undefined) {
      return undefined;
    }
    return isQueue ? queueProblems(data, new Date()) : groupProblems(data);
  }, [data, isQueue]);

  // The marks are asked for exactly the reports on this screen.
  const problemIds = useMemo(
    () => (data === undefined ? NO_IDS : data.map((problem) => problem.id)),
    [data],
  );
  const unread = useUnreadSubjects(NO_IDS, problemIds);

  const onRefresh = useCallback(() => {
    void refetch();
    unread.refetch();
  }, [refetch, unread]);

  const onPress = useCallback((problemId: string) => {
    router.push({ pathname: '/problem/[id]', params: { id: problemId } });
  }, []);

  const onReport = useCallback(() => {
    router.push('/problem/new');
  }, []);

  return (
    <View style={styles.screen}>
      <ProblemList
        sections={sections}
        isLoading={isPending}
        error={error}
        onRefresh={onRefresh}
        isRefreshing={isRefetching}
        onPress={onPress}
        unreadProblemIds={unread.problems}
      />
      {canReport ? (
        <ActionBar>
          <Button label={t('problems.report')} onPress={onReport} />
        </ActionBar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
