import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { canEditSupplyRequest } from '@/features/supplies/schema';
import { SupplyDetail } from '@/features/supplies/supply-detail';
import { useDeleteSupplyRequest, useSupplyRequest } from '@/features/supplies/use-supplies';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

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
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('supplies.loading')}</Text>
      </View>
    );
  }

  if (request.error) {
    const failure = serverErrorText(request.error);
    return <Message text={failure.text} detail={failure.detail} styles={styles} />;
  }

  if (request.data === null || request.data === undefined) {
    return <Message text={t('supplies.notFound')} styles={styles} />;
  }

  const onDelete = () => {
    Alert.alert(t('supplies.delete'), t('supplies.deleteQuestion'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('supplies.delete'), style: 'destructive', onPress: () => remove.mutate(requestId) },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: t('supplies.one') }} />
      <SupplyDetail
        request={request.data}
        canEdit={canEditSupplyRequest(request.data, userId)}
        onEdit={() => router.push({ pathname: '/supply/new', params: { id: requestId } })}
        onDelete={onDelete}
        isDeleting={remove.isPending && !remove.isPaused}
        error={remove.error}
      />
    </>
  );
}

interface MessageProps {
  text: string;
  detail?: string | null;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, detail = null, styles }: MessageProps) {
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>{text}</Text>
      {detail !== null ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.sm,
      backgroundColor: theme.background,
    },
    message: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
    detail: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'center' },
  });
