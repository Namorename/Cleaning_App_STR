import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ActionBar } from '@/components/action-bar';
import { Button } from '@/components/button';
import { isTechnician } from '@/features/auth/role';
import { useRole } from '@/features/auth/use-role';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { ProblemList } from '@/features/problems/problem-list';
import { groupProblems } from '@/features/problems/schema';
import { useMyProblems } from '@/features/problems/use-problems';

const NO_IDS: readonly string[] = [];

/**
 * Her reports, with «Создать задание» pinned under them, above the tab bar:
 * as the first row of the list it scrolled away, and it was missing whenever
 * the list could not load — when she is offline, which is exactly when a
 * report has to wait in the queue.
 *
 * A technician has no listings to report on from here: he raises a task from
 * his repair, where its listing fills itself in (docs/tech-plan.md §4) — and
 * the head technician has none either. They get the list without the button.
 */
export default function ProblemsScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyProblems();
  const canReport = !isTechnician(useRole());

  const sections = useMemo(() => (data === undefined ? undefined : groupProblems(data)), [data]);

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
