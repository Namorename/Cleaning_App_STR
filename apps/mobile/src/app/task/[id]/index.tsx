import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ErrorState } from '@/components/error-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { isTechnician } from '@/features/auth/role';
import { useSession } from '@/features/auth/session';
import { SignedInRoute } from '@/features/auth/signed-in-route';
import { useRole } from '@/features/auth/use-role';
import { useTaskSteps } from '@/features/steps/use-steps';
import { propertyName } from '@/features/tasks/format';
import { latestMoveError } from '@/features/tasks/moves';
import { TaskDetail, TaskDetailSkeleton } from '@/features/tasks/task-detail';
import {
  acceptVariables,
  useAcceptTask,
  useClaimTask,
  useFinishTask,
  useStartTask,
  useTask,
} from '@/features/tasks/use-tasks';
import { useNow } from '@/hooks/use-now';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { wordContext } from '@/i18n';

const Params = z.object({ id: z.string().uuid() });

/**
 * One task, opened from a list or, cold, from a notification: the guard waits
 * for the stored session before the screen can say the task is not hers.
 */
export default function TaskRoute() {
  const { t } = useTranslation();

  return (
    <SignedInRoute loadingText={t('tasks.loading', { context: wordContext() })}>
      <TaskScreen />
    </SignedInRoute>
  );
}

/**
 * One task. Thin: params in, hooks wired, the screen itself is TaskDetail.
 *
 * safeParse rather than parse: a malformed link must not crash the screen.
 * The steps are a query of their own: the task row is shared with the lists
 * and stays light, the steps exist only once the task has started.
 */
function TaskScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  // No «Расходники» for a technician (docs/tech-plan.md §0, §4): a request
  // sent from his job would land in a tab he does not have.
  const canRequestSupplies = !isTechnician(useRole());
  const parsed = Params.safeParse(useLocalSearchParams());
  const taskId = parsed.success ? parsed.data.id : null;

  const query = useTask(taskId ?? '');
  const steps = useTaskSteps(taskId ?? '');
  const claim = useClaimTask();
  const accept = useAcceptTask();
  const start = useStartTask();
  const finish = useFinishTask();
  const now = useNow();

  const isBusy = claim.isPending || accept.isPending || start.isPending || finish.isPending;
  // One line for a failure, and it is about the move she made last.
  const error = latestMoveError([claim, accept, start, finish]);

  if (taskId === null || userId === null) {
    return (
      <Message text={t('tasks.detail.notFound', { context: wordContext() })} styles={styles} />
    );
  }

  if (query.isPending) {
    return <TaskDetailSkeleton label={t('tasks.loading', { context: wordContext() })} />;
  }

  // A task that never loaded. One that did and only failed to refresh
  // (TanStack keeps the data beside the error) stays on screen below.
  if (query.error && query.data === undefined) {
    return (
      <View style={styles.screen}>
        <ErrorState
          error={query.error}
          title={t('tasks.loadFailed', { context: wordContext() })}
          onRetry={() => void query.refetch()}
        />
      </View>
    );
  }

  if (query.data === null || query.data === undefined) {
    return (
      <Message text={t('tasks.detail.notFound', { context: wordContext() })} styles={styles} />
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: propertyName(query.data) }} />
      <TaskDetail
        task={query.data}
        userId={userId}
        now={now}
        isBusy={isBusy}
        isAccepting={accept.isPending}
        error={error}
        refreshError={query.error}
        steps={steps.data}
        onClaim={(id) => claim.mutate({ taskId: id, cleanerId: userId })}
        onAccept={(task) => accept.mutate(acceptVariables(task))}
        onStart={(id) => start.mutate(id)}
        onFinish={(id) => finish.mutate(id)}
        onOpenStep={(stepId) =>
          router.push({ pathname: '/task/[id]/step/[stepId]', params: { id: taskId, stepId } })
        }
        onReportProblem={(id) => router.push({ pathname: '/problem/new', params: { taskId: id } })}
        onRequestSupplies={
          canRequestSupplies
            ? (id) => router.push({ pathname: '/supply/new', params: { taskId: id } })
            : undefined
        }
        onOpenProblem={(problemId) =>
          router.push({ pathname: '/problem/[id]', params: { id: problemId } })
        }
        onOpenChat={(id) =>
          router.push({ pathname: '/chat/[subject]/[id]', params: { subject: 'task', id } })
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
