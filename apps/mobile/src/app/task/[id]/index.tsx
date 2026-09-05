import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useTaskSteps } from '@/features/steps/use-steps';
import { propertyName } from '@/features/tasks/format';
import { TaskDetail } from '@/features/tasks/task-detail';
import { useClaimTask, useFinishTask, useStartTask, useTask } from '@/features/tasks/use-tasks';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid() });

/**
 * One task. Thin: params in, hooks wired, the screen itself is TaskDetail.
 *
 * safeParse rather than parse: a malformed link must not crash the screen.
 * The steps are a query of their own: the task row is shared with the lists
 * and stays light, the steps exist only once the task has started.
 */
export default function TaskScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const parsed = Params.safeParse(useLocalSearchParams());
  const taskId = parsed.success ? parsed.data.id : null;

  const query = useTask(taskId ?? '');
  const steps = useTaskSteps(taskId ?? '');
  const claim = useClaimTask();
  const start = useStartTask();
  const finish = useFinishTask();

  const isBusy = claim.isPending || start.isPending || finish.isPending;
  const error = claim.error ?? start.error ?? finish.error;

  if (taskId === null || userId === null) {
    return <Message text={t('tasks.detail.notFound')} styles={styles} />;
  }

  if (query.isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('tasks.loading')}</Text>
      </View>
    );
  }

  if (query.error) {
    return <Message text={query.error.message} styles={styles} />;
  }

  if (query.data === null || query.data === undefined) {
    return <Message text={t('tasks.detail.notFound')} styles={styles} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: propertyName(query.data) }} />
      <TaskDetail
        task={query.data}
        userId={userId}
        isBusy={isBusy}
        error={error}
        steps={steps.data}
        onClaim={(id) => claim.mutate({ taskId: id, cleanerId: userId })}
        onStart={(id) => start.mutate(id)}
        onFinish={(id) => finish.mutate(id)}
        onOpenStep={(stepId) =>
          router.push({ pathname: '/task/[id]/step/[stepId]', params: { id: taskId, stepId } })
        }
      />
    </>
  );
}

interface MessageProps {
  text: string;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, styles }: MessageProps) {
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>{text}</Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
      backgroundColor: theme.background,
    },
    message: { fontSize: FontSize.body, color: theme.textSecondary, textAlign: 'center' },
  });
