import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { z } from 'zod';

import { useUnreadSubjects } from '@/features/chat/use-chat';
import { PUSH_NOTICES } from '@/features/push/destination';
import { PushNotice } from '@/features/tasks/push-notice';
import { groupMyTasks } from '@/features/tasks/schema';
import { TaskList } from '@/features/tasks/task-list';
import type { CleaningTask } from '@/features/tasks/schema';
import { acceptVariables, useAcceptTask, useMyTasks } from '@/features/tasks/use-tasks';
import { wordContext } from '@/i18n';
import { alertMessage, serverErrorText } from '@/lib/server-error';

const NO_IDS: readonly string[] = [];
const NO_ACCEPTS: ReadonlySet<string> = new Set();

/** Set by a tap on a push about a cleaning that is no longer hers (features/push/hooks.ts). */
const Params = z.object({ notice: z.enum(PUSH_NOTICES).optional() });

export default function MyTasksScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyTasks();
  const { mutateAsync: accept } = useAcceptTask();
  const [acceptingIds, setAcceptingIds] = useState<ReadonlySet<string>>(NO_ACCEPTS);
  const parsed = Params.safeParse(useLocalSearchParams());
  const notice = parsed.success ? parsed.data.notice : undefined;

  // Work under way first, as its own section: several cleanings run at once
  // on a floor, and this list is how she switches between them. Then a section
  // per day, grouped here from the rows already fetched.
  const sections = useMemo(() => (data === undefined ? undefined : groupMyTasks(data)), [data]);

  // The marks are asked for exactly the jobs on this screen. A repair speaks
  // in its report's thread, so its report is asked about too.
  const taskIds = useMemo(
    () => (data === undefined ? NO_IDS : data.map((task) => task.id)),
    [data],
  );
  const problemIds = useMemo(
    () =>
      data === undefined
        ? NO_IDS
        : data.flatMap((task) => (task.problem == null ? [] : [task.problem.id])),
    [data],
  );
  const unread = useUnreadSubjects(taskIds, problemIds);

  const onRefresh = useCallback(() => {
    void refetch();
    unread.refetch();
  }, [refetch, unread]);

  const onPress = useCallback((taskId: string) => {
    router.push({ pathname: '/task/[id]', params: { id: taskId } });
  }, []);

  // Tomorrow's cleanings are accepted from the list, one card after another,
  // without opening each. Every card keeps its own promise: the callbacks of
  // an earlier mutate() are dropped once a later one is made, and a refusal
  // for the first card must not be lost because she tapped the second. A
  // refusal means the office changed it — given to someone else, moved or
  // cancelled — so she is told, and the refreshed list shows what it is now.
  const onAccept = useCallback(
    (task: CleaningTask) => {
      const taskId = task.id;
      setAcceptingIds((ids) => new Set(ids).add(taskId));
      accept(acceptVariables(task))
        .catch((mutationError: unknown) => {
          Alert.alert(
            t('tasks.acceptFailedTitle', { context: wordContext() }),
            alertMessage(serverErrorText(mutationError)),
          );
          void refetch();
        })
        .finally(() =>
          setAcceptingIds((ids) => {
            const rest = new Set(ids);
            rest.delete(taskId);
            return rest;
          }),
        );
    },
    [accept, refetch, t],
  );

  return (
    <TaskList
      sections={sections}
      isLoading={isPending}
      error={error}
      onRefresh={onRefresh}
      isRefreshing={isRefetching}
      onPress={onPress}
      onAccept={onAccept}
      acceptingTaskIds={acceptingIds}
      unreadTaskIds={unread.tasks}
      unreadProblemIds={unread.problems}
      // A technician has no free queue to be sent to (docs/tech-plan.md §4).
      emptyMessage={t('tasks.emptyMine', { context: wordContext() })}
      header={
        notice === undefined ? undefined : (
          <PushNotice notice={notice} onDismiss={() => router.setParams({ notice: undefined })} />
        )
      }
    />
  );
}
