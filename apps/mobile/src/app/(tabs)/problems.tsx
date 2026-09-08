import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ListAction } from '@/components/list-action';
import { ProblemList } from '@/features/problems/problem-list';
import { groupProblems } from '@/features/problems/schema';
import { useMyProblems } from '@/features/problems/use-problems';

export default function ProblemsScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyProblems();

  const sections = useMemo(() => (data === undefined ? undefined : groupProblems(data)), [data]);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

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
      header={<ListAction label={t('problems.report')} onPress={onReport} />}
    />
  );
}
