import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ListAction } from '@/components/list-action';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { ProblemList } from '@/features/problems/problem-list';
import { groupProblems } from '@/features/problems/schema';
import { useMyProblems } from '@/features/problems/use-problems';

const NO_IDS: readonly string[] = [];

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
    <ProblemList
      sections={sections}
      isLoading={isPending}
      error={error}
      onRefresh={onRefresh}
      isRefreshing={isRefetching}
      onPress={onPress}
      unreadProblemIds={unread.problems}
      header={<ListAction label={t('problems.report')} onPress={onReport} />}
    />
  );
}
