import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useSession } from '@/features/auth/session';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { groupByDay } from '@/features/tasks/schema';
import { TaskList } from '@/features/tasks/task-list';
import { useClaimTask, useFreeTasks } from '@/features/tasks/use-tasks';
import { alertMessage, serverErrorText } from '@/lib/server-error';

const NO_IDS: readonly string[] = [];
const NO_CLAIMS: ReadonlySet<string> = new Set();

export default function FreeQueueScreen() {
  const { t } = useTranslation();
  const { userId } = useSession();
  const { data, isPending, error, refetch, isRefetching } = useFreeTasks();
  const { mutateAsync: claim } = useClaimTask();
  const [claimingIds, setClaimingIds] = useState<ReadonlySet<string>>(NO_CLAIMS);

  // A section per day, grouped here from the rows already fetched: the queue
  // spans a week, and which day a cleaning is on decides whether she can take
  // it. No work under way here by definition.
  const sections = useMemo(() => (data === undefined ? undefined : groupByDay(data)), [data]);

  // A note the office left on free work is the case the conversation exists
  // for, so the queue carries the marks too.
  const taskIds = useMemo(
    () => (data === undefined ? NO_IDS : data.map((task) => task.id)),
    [data],
  );
  const unread = useUnreadSubjects(taskIds, NO_IDS);

  const onRefresh = useCallback(() => {
    void refetch();
    unread.refetch();
  }, [refetch, unread]);

  // A free task opens before it is taken: the listing's notes and the
  // office's words in the chat are what she decides by. The task screen offers
  // the same claim.
  const onPress = useCallback((taskId: string) => {
    router.push({ pathname: '/task/[id]', params: { id: taskId } });
  }, []);

  // Every claim keeps its own promise, as «Принять» in «Мои уборки» does: the
  // callbacks of an earlier mutate() are dropped once a later one is made, and
  // the answer to the first «Взять» must not be lost because she tapped the
  // second. Losing the race is an ordinary outcome, not a failure of the app —
  // say who it affects and let the refreshed list show the truth. What the
  // server said in its own words is the second paragraph, never the whole
  // message.
  const onClaim = useCallback(
    (taskId: string) => {
      if (userId === null) {
        return;
      }
      setClaimingIds((ids) => new Set(ids).add(taskId));
      claim({ taskId, cleanerId: userId })
        .catch((mutationError: unknown) => {
          Alert.alert(t('tasks.claimFailedTitle'), alertMessage(serverErrorText(mutationError)));
          void refetch();
        })
        .finally(() =>
          setClaimingIds((ids) => {
            const rest = new Set(ids);
            rest.delete(taskId);
            return rest;
          }),
        );
    },
    [claim, refetch, t, userId],
  );

  return (
    <TaskList
      sections={sections}
      isLoading={isPending}
      error={error}
      onRefresh={onRefresh}
      isRefreshing={isRefetching}
      onPress={onPress}
      onClaim={onClaim}
      claimingTaskIds={claimingIds}
      unreadTaskIds={unread.tasks}
      emptyMessage={t('tasks.emptyQueue')}
    />
  );
}
