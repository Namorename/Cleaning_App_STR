import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorBanner } from '@/components/error-banner';
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
  isWaiting,
  liveRepair,
  type BoardProblem,
} from './schema';
import {
  useAssignProblem,
  useBoardProblem,
  useDispatchInFlight,
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
 * read again (use-board.ts). They are offered only on what the screen read
 * from the server since it opened, never on the board's copy or one kept from
 * before; one at a time, busy until the task is read again after it; «Снять»
 * once the names are known, since its question names the person.
 */
export function ProblemDispatch({ problemId }: ProblemDispatchProps) {
  const { t } = useTranslation();
  const { userId } = useSession();
  const problem = useBoardProblem(problemId);
  const staff = useStaffDirectory();
  const assign = useAssignProblem();
  const takeOff = useUnassignProblem();
  const inFlight = useDispatchInFlight();
  const [isAssigning, setAssigning] = useState(false);
  // The take-off asked about: the repair and the person the question named,
  // kept while the question fades out.
  const [takeOffAsked, setTakeOffAsked] = useState<TakeOffTarget | null>(null);
  const [isAskingTakeOff, setAskingTakeOff] = useState(false);
  const names = useMemo(() => staffNames(staff.data, t), [staff.data, t]);
  const technicians = useMemo(
    () => (staff.data === undefined ? undefined : activeTechnicians(staff.data)),
    [staff.data],
  );

  const task = problem.data ?? null;
  const repair = task === null ? null : liveRepair(task);
  const holder = repair?.assignee_id ?? null;
  // Read from the server since the screen opened, and the last read did not fail.
  const isCurrent = problem.isFetchedAfterMount && problem.error === null;
  const areNamesKnown = staff.data !== undefined;
  const namesFailure = areNamesKnown ? null : staff.error;
  const isMoving = inFlight.isMoving || assign.isPending || takeOff.isPending;

  const openSheet = () => {
    // A move under way is never forgotten: its answer and its refusal stay.
    if (inFlight.isMovingNow()) {
      return;
    }
    assign.reset();
    takeOff.reset();
    setAssigning(true);
  };

  const onAssign = (assigneeId: string, scheduledDate: string) => {
    if (inFlight.isMovingNow()) {
      return;
    }
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

  // Asked in the app's own dialog (owner, 2026-10-10), not the system's
  // Alert. The person is the one the question named: a refresh while it is
  // open does not change whom «Снять» takes off — the server refuses a repair
  // that has changed hands meanwhile (taskChangedMeanwhile).
  const confirmTakeOff = () => {
    if (repair === null || holder === null) {
      return;
    }
    setTakeOffAsked({ taskId: repair.id, assigneeId: holder });
    setAskingTakeOff(true);
  };

  const takeOffAnswered = () => {
    setAskingTakeOff(false);
    if (takeOffAsked !== null && !inFlight.isMovingNow()) {
      takeOff.mutate({ taskId: takeOffAsked.taskId, expectedAssigneeId: takeOffAsked.assigneeId });
    }
  };

  const readAgain = () => {
    if (problem.error !== null) {
      void problem.refetch();
    }
    if (namesFailure !== null) {
      void staff.refetch();
    }
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

      {problem.error !== null ? (
        <ErrorBanner title={t('problems.dispatch.readFailed')} error={problem.error} />
      ) : null}
      {namesFailure !== null ? (
        <ErrorBanner title={t('problems.dispatch.namesFailed')} error={namesFailure} />
      ) : null}
      {problem.error !== null || namesFailure !== null ? (
        <Button variant="outline" label={t('common.retry')} onPress={readAgain} />
      ) : null}
      {takeOff.error !== null ? <FailureText error={takeOff.error} /> : null}

      {task !== null && canAssign(task) ? (
        <Button
          label={t('problems.dispatch.assign')}
          isBusy={assign.isPending}
          // Busy in its own fill while it is its move; greyed while the other one is under way.
          isDisabled={!isCurrent || (isMoving && !assign.isPending)}
          onPress={openSheet}
        />
      ) : null}
      {task !== null && isWaiting(task) && !canAssign(task) ? (
        // Said before he chooses anybody: assign_problem refuses a task with no listing.
        <Text tone="secondary">{t('problems.dispatch.noProperty')}</Text>
      ) : null}
      {task !== null && canTakeOff(task) ? (
        <Button
          variant="destructive"
          label={t('problems.dispatch.takeOff')}
          isBusy={takeOff.isPending}
          isDisabled={!isCurrent || !areNamesKnown || (isMoving && !takeOff.isPending)}
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
          names={names}
          staffError={staff.error}
          onRetryStaff={() => void staff.refetch()}
          meId={userId}
          isBusy={assign.isPending}
          error={assign.error}
          onAssign={onAssign}
          // Closing the sheet leaves a move under way alone: its answer still lands.
          onClose={() => setAssigning(false)}
        />
      ) : null}

      <ConfirmDialog
        isVisible={isAskingTakeOff}
        title={t('problems.dispatch.takeOffTitle')}
        message={
          takeOffAsked === null
            ? undefined
            : t('problems.dispatch.takeOffQuestion', {
                name: personName(names, takeOffAsked.assigneeId),
              })
        }
        confirmLabel={t('problems.dispatch.takeOffConfirm')}
        variant="destructive"
        onConfirm={takeOffAnswered}
        onCancel={() => setAskingTakeOff(false)}
      />
    </View>
  );
}

/** The repair a take-off was asked about, and the person it named. */
interface TakeOffTarget {
  taskId: string;
  assigneeId: string;
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
