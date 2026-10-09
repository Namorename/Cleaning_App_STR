import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { FailureText } from '@/components/failure-text';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session';

import { AssignSheet } from './assign-sheet';
import { Nobody } from './board-card';
import { personName, repairWhen, staffNames } from './format';
import {
  activeTechnicians,
  canAssign,
  canTakeOff,
  isLive,
  liveRepair,
  type BoardProblem,
} from './schema';
import {
  useAssignProblem,
  useBoardProblem,
  useStaffDirectory,
  useUnassignProblem,
} from './use-board';

interface ProblemDispatchProps {
  problemId: string;
}

/**
 * The head technician's part of a task's screen (brief, item 2): who holds
 * its repair and for which day, «Назначить» while it is open and nobody holds
 * it, «Снять с работы» while somebody does, and the history. Cancelling,
 * closing and the archive are the manager's (decision 1): no button for them.
 *
 * Both moves are dispatch: sent at once or not at all, never queued; a refusal
 * is said here in his words, and the screen changes when the server has been
 * read again (use-board.ts).
 */
export function ProblemDispatch({ problemId }: ProblemDispatchProps) {
  const { t } = useTranslation();
  const { userId } = useSession();
  const problem = useBoardProblem(problemId);
  const staff = useStaffDirectory();
  const assign = useAssignProblem();
  const takeOff = useUnassignProblem();
  const [isAssigning, setAssigning] = useState(false);
  const names = useMemo(() => staffNames(staff.data), [staff.data]);
  const technicians = useMemo(
    () => (staff.data === undefined ? undefined : activeTechnicians(staff.data)),
    [staff.data],
  );

  const task = problem.data ?? null;
  const repair = task === null ? null : liveRepair(task);
  const holder = repair?.assignee_id ?? null;

  const openSheet = () => {
    assign.reset();
    takeOff.reset();
    setAssigning(true);
  };

  const onAssign = (assigneeId: string, scheduledDate: string) => {
    assign.mutate(
      {
        problemId,
        assigneeId,
        scheduledDate,
        // A waiting repair keeps the hours the office gave it.
        timeFrom: repair?.time_from ?? null,
        timeTo: repair?.time_to ?? null,
      },
      { onSuccess: () => setAssigning(false) },
    );
  };

  const confirmTakeOff = () => {
    if (repair === null || holder === null) {
      return;
    }
    Alert.alert(
      t('problems.dispatch.takeOffTitle'),
      t('problems.dispatch.takeOffQuestion', { name: personName(names, holder) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('problems.dispatch.takeOffConfirm'),
          style: 'destructive',
          onPress: () => takeOff.mutate({ taskId: repair.id, expectedAssigneeId: holder }),
        },
      ],
    );
  };

  return (
    <View style={styles.section}>
      {task !== null && (isLive(task) || holder !== null) ? (
        <Card>
          <Fact label={t('problems.dispatch.assignee')}>
            {holder === null ? (
              <Nobody label={t('problems.board.nobody')} />
            ) : (
              <Text align="right" style={styles.value}>
                {personName(names, holder)}
              </Text>
            )}
          </Fact>
          <RepairDay task={task} label={t('problems.dispatch.day')} />
        </Card>
      ) : null}

      {task === null && problem.error !== null ? <FailureText error={problem.error} /> : null}
      {takeOff.error !== null ? <FailureText error={takeOff.error} /> : null}

      {task !== null && canAssign(task) ? (
        <Button label={t('problems.dispatch.assign')} onPress={openSheet} />
      ) : null}
      {task !== null && canTakeOff(task) ? (
        <Button
          variant="destructive"
          label={t('problems.dispatch.takeOff')}
          isBusy={takeOff.isPending}
          onPress={confirmTakeOff}
        />
      ) : null}
      <Button
        variant="outline"
        label={t('problems.dispatch.history')}
        onPress={() =>
          router.push({ pathname: '/problem/[id]/history', params: { id: problemId } })
        }
      />

      {isAssigning ? (
        <AssignSheet
          technicians={technicians}
          staffError={staff.error}
          meId={userId}
          isBusy={assign.isPending}
          error={assign.error}
          onAssign={onAssign}
          onClose={() => setAssigning(false)}
        />
      ) : null}
    </View>
  );
}

interface RepairDayProps {
  task: BoardProblem;
  label: string;
}

/** The live repair's day and hours, when it has a day. */
function RepairDay({ task, label }: RepairDayProps) {
  const repair = liveRepair(task);
  const when = repair === null ? null : repairWhen(repair);
  if (when === null) {
    return null;
  }
  return (
    <Fact label={label}>
      <Text align="right" style={styles.value}>
        {when}
      </Text>
    </Fact>
  );
}

interface FactProps {
  label: string;
  children: ReactNode;
}

/** A fact and its value on one line; at a large font the value wraps under it (problem-detail). */
function Fact({ label, children }: FactProps) {
  return (
    <View style={styles.fact}>
      <Text tone="secondary" style={styles.value}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/** Sizes only: the colours are the components'. */
const styles = StyleSheet.create({
  section: { gap: Spacing.md },
  fact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: Spacing.md,
    rowGap: Spacing.xs,
  },
  value: { flexShrink: 1 },
});
