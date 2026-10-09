import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ErrorState } from '@/components/error-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { canEditSupplyRequest } from '@/features/supplies/schema';
import { SupplyDetail, SupplyDetailSkeleton } from '@/features/supplies/supply-detail';
import { useDeleteSupplyRequest, useSupplyRequest } from '@/features/supplies/use-supplies';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid() });

/** One request. Withdrawing asks first: it cannot be undone. */
export default function SupplyRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const parsed = Params.safeParse(useLocalSearchParams());
  const requestId = parsed.success ? parsed.data.id : '';

  const request = useSupplyRequest(requestId);
  const remove = useDeleteSupplyRequest();

  const isLeaving = remove.isSuccess || remove.isPaused;
  useEffect(() => {
    if (isLeaving) {
      router.back();
    }
  }, [isLeaving]);

  if (!parsed.success || userId === null) {
    return <Message text={t('supplies.notFound')} styles={styles} />;
  }

  if (request.isPending) {
    return <SupplyDetailSkeleton label={t('supplies.loading')} />;
  }

  // A request that never loaded. One that did and only failed to refresh
  // (TanStack keeps the data beside the error) stays on screen below. There
  // is no «could not load the request» of its own: the general sentence.
  if (request.error && request.data === undefined) {
    return (
      <View style={styles.screen}>
        <ErrorState
          error={request.error}
          title={t('common.screenFailed')}
          onRetry={() => void request.refetch()}
        />
      </View>
    );
  }

  if (request.data === null || request.data === undefined) {
    // Withdrawn: the refetch after it finds no row while the screen leaves —
    // that is not «not found».
    return isLeaving ? (
      <View style={styles.screen} />
    ) : (
      <Message text={t('supplies.notFound')} styles={styles} />
    );
  }

  const onDelete = () => {
    Alert.alert(t('supplies.delete'), t('supplies.deleteQuestion'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('supplies.delete'), style: 'destructive', onPress: () => remove.mutate(requestId) },
    ]);
  };

  // Titled by the root layout: a request still loading, or one that failed,
  // stands under the same header.
  return (
    <SupplyDetail
      request={request.data}
      canEdit={canEditSupplyRequest(request.data, userId)}
      onEdit={() => router.push({ pathname: '/supply/new', params: { id: requestId } })}
      onDelete={onDelete}
      isDeleting={remove.isPending && !remove.isPaused}
      error={remove.error}
      refreshError={request.error}
    />
  );
}

interface MessageProps {
  text: string;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, styles }: MessageProps) {
  return (
    <View style={[styles.screen, styles.centered]}>
      <Text tone="secondary" align="center">
        {text}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
    },
  });
