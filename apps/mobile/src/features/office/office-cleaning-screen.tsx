import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { staffNames } from '@/features/board/format';
import { useStaffDirectory } from '@/features/board/use-board';
import { PlaceInstructions } from '@/features/knowledge/place-instructions';
import { useTaskSteps } from '@/features/steps/use-steps';
import { propertyName } from '@/features/tasks/format';
import { HandBackSheet } from '@/features/tasks/hand-back-sheet';
import { latestMoveError } from '@/features/tasks/moves';
import { cleaningOffs } from '@/features/tasks/offs';
import { TaskDetailSkeleton } from '@/features/tasks/task-detail';
import { useCleaningOff } from '@/features/tasks/use-cleaning-off';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { CleanerSheet } from './cleaner-sheet';
import { OfficeCleaning } from './office-cleaning';
import { activeCleaners } from './schema';
import { useAssignCleaning, useOfficeTask, useRestoreCleaning } from './use-office';

interface OfficeCleaningScreenProps {
  taskId: string;
}

/** Which of the office's questions is open over the card. */
type Asked = 'assign' | 'cancel' | 'restore' | null;

/**
 * A cleaning opened on the office's phone — from its «Уборки», or from a push
 * about a cleaning a cleaner handed back (cleaning_declined,
 * cleaning_interrupted): the office card, with «Назначить» and «Отменить
 * уборку», never «Взять». Thin: the hooks and the sheets; the card is
 * `OfficeCleaning`.
 */
export function OfficeCleaningScreen({ taskId }: OfficeCleaningScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const query = useOfficeTask(taskId);
  const steps = useTaskSteps(taskId);
  const staff = useStaffDirectory();
  const assign = useAssignCleaning();
  const restore = useRestoreCleaning();
  const off = useCleaningOff();
  const [asked, setAsked] = useState<Asked>(null);
  const names = useMemo(() => staffNames(staff.data, t), [staff.data, t]);
  const cleaners = useMemo(
    () => (staff.data === undefined ? undefined : activeCleaners(staff.data)),
    [staff.data],
  );

  if (query.isPending) {
    return <TaskDetailSkeleton label={t('tasks.loading')} />;
  }

  if (query.error && query.data === undefined) {
    return (
      <View style={styles.screen}>
        <ErrorState
          error={query.error}
          title={t('tasks.loadFailed')}
          onRetry={() => void query.refetch()}
        />
      </View>
    );
  }

  const task = query.data ?? null;
  if (task === null || userId === null) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text tone="secondary" align="center">
          {t('tasks.detail.notFound')}
        </Text>
      </View>
    );
  }

  const isBusy = assign.isPending || restore.isPending || off.isPending;
  const canCancel = cleaningOffs(task, userId, true).includes('cancel');

  // A question is opened on a clean slate: an answer on its way is never forgotten.
  const ask = (next: Exclude<Asked, null>) => {
    if (isBusy) {
      return;
    }
    assign.reset();
    restore.reset();
    off.reset();
    setAsked(next);
  };

  return (
    <>
      <Stack.Screen options={{ title: propertyName(task) }} />
      <OfficeCleaning
        task={task}
        steps={steps.data}
        isBusy={isBusy}
        isCurrent={query.isFetchedAfterMount && query.error === null}
        error={latestMoveError([assign, restore])}
        refreshError={query.error}
        canCancel={canCancel}
        onAssign={() => ask('assign')}
        onCancel={() => ask('cancel')}
        onRestore={() => ask('restore')}
        onOpenStep={(stepId) =>
          router.push({ pathname: '/task/[id]/step/[stepId]', params: { id: taskId, stepId } })
        }
        onOpenProblem={(problemId) =>
          router.push({ pathname: '/problem/[id]', params: { id: problemId } })
        }
        onOpenChat={(id) =>
          router.push({ pathname: '/chat/[subject]/[id]', params: { subject: 'task', id } })
        }
        instructions={<PlaceInstructions propertyId={task.property_id} />}
      />
      {asked === 'assign' ? (
        <CleanerSheet
          cleaners={cleaners}
          names={names}
          currentId={task.assignee_id}
          staffError={staff.data === undefined ? staff.error : null}
          onRetryStaff={() => void staff.refetch()}
          isBusy={assign.isPending}
          error={assign.error}
          onAssign={(assigneeId) =>
            assign.mutate(
              { taskId, assigneeId, shownDate: task.scheduled_date },
              { onSuccess: () => setAsked(null) },
            )
          }
          onClose={() => setAsked(null)}
        />
      ) : null}
      {asked === 'cancel' ? (
        <HandBackSheet
          kind="cancel"
          isBusy={off.isPending}
          error={off.error}
          onConfirm={(reason) =>
            off.mutate({ kind: 'cancel', taskId, reason }, { onSuccess: () => setAsked(null) })
          }
          onClose={() => setAsked(null)}
        />
      ) : null}
      <ConfirmDialog
        isVisible={asked === 'restore'}
        title={t('office.cleaning.restoreTitle')}
        message={t('office.cleaning.restoreText')}
        confirmLabel={t('office.cleaning.restoreConfirm')}
        cancelLabel={t('office.cleaning.keep')}
        onConfirm={() => {
          setAsked(null);
          restore.mutate(taskId);
        }}
        onCancel={() => setAsked(null)}
      />
    </>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    centered: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  });
