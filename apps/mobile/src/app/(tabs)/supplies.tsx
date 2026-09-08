import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ListAction } from '@/components/list-action';
import { groupSupplyRequests } from '@/features/supplies/schema';
import { SupplyList } from '@/features/supplies/supply-list';
import { useMySupplyRequests } from '@/features/supplies/use-supplies';

export default function SuppliesScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMySupplyRequests();

  const sections = useMemo(
    () => (data === undefined ? undefined : groupSupplyRequests(data)),
    [data],
  );

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const onPress = useCallback((requestId: string) => {
    router.push({ pathname: '/supply/[id]', params: { id: requestId } });
  }, []);

  const onRequest = useCallback(() => {
    router.push('/supply/new');
  }, []);

  return (
    <SupplyList
      sections={sections}
      isLoading={isPending}
      error={error}
      onRefresh={onRefresh}
      isRefreshing={isRefetching}
      onPress={onPress}
      header={<ListAction label={t('supplies.request')} onPress={onRequest} />}
    />
  );
}
