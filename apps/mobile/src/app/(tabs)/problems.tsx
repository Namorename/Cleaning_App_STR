import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ActionBar } from '@/components/action-bar';
import { Button } from '@/components/button';
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
 */
export default function ProblemsScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyProblems();

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
      <ActionBar>
        <Button label={t('problems.report')} onPress={onReport} />
      </ActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
