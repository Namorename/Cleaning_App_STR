import { STATUS_TONE, problemPriorityTone } from '@str-ops/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { useScreenEdgePadding } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorBanner } from '@/components/error-banner';
import { FailureText } from '@/components/failure-text';
import { Icon } from '@/components/icon';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { BUTTON_HEIGHT, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { remainingRequired, type TaskStep } from '@/features/steps/schema';
import { StepList } from '@/features/steps/step-list';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { wordContext } from '@/i18n';

import {
  formatClockTime,
  formatScheduledDate,
  formatStartNotBefore,
  formatWindow,
  jobWordKey,
  propertyName,
  taskPlace,
  urgencyText,
} from './format';
import { availableActions, canStartNow, isSameDayTurnover, type CleaningTask } from './schema';

interface TaskDetailProps {
  task: CleaningTask;
  userId: string;
  /** The clock the start button is judged against; ticks in the route. */
  now: Date;
  isBusy: boolean;
  /** The busy move is the accept: its own button spins, not greyed by the other moves. */
  isAccepting?: boolean;
  /** The last action's failure, shown next to the button so she can retry. */
  error: Error | null;
  /**
   * A refresh that failed over the task still on screen: said above it, the
   * task stays (a failure to load at all is the route's error state).
   */
  refreshError?: Error | null;
  /** The task's process, once it has started. Undefined while loading. */
  steps?: readonly TaskStep[];
  onClaim: (taskId: string) => void;
  /** Gets the task as shown: what she accepts is this day and this flat. */
  onAccept: (task: CleaningTask) => void;
  onStart: (taskId: string) => void;
  onFinish: (taskId: string) => void;
  onOpenStep?: (stepId: string) => void;
  /** Offered while the task is hers and open: something is broken, or running out. */
  onReportProblem?: (taskId: string) => void;
  onRequestSupplies?: (taskId: string) => void;
  /** On a maintenance task: the report it fixes. */
  onOpenProblem?: (problemId: string) => void;
  /** The conversation about this job. Offered to whoever can see the job at all. */
  onOpenChat?: (taskId: string) => void;
}

/**
 * One task, and what she can do with it right now.
 *
 * Presentational: the route wires the hooks in. One main action at a time —
 * take, start or finish — because the database allows one, and a screen with
 * two main buttons where one is going to be refused is a screen that lies.
 * Accepting sits beside it as a quieter button of its own: a signal to the
 * office the server takes at any time, not a step the start waits for. Once
 * the task has started its steps sit between the facts and the button; a
 * required step still open disables the finish and says why, mirroring the
 * refusal the server would give. The start is held the same way until the
 * cleaning window opens.
 *
 * The owner kept this screen's layout (decisions §2, «Уборка и шаги»): the
 * main button stays at the end of the scroll, only the look is direction A's.
 */
export function TaskDetail({
  task,
  userId,
  now,
  isBusy,
  isAccepting = false,
  error,
  refreshError = null,
  steps,
  onClaim,
  onAccept,
  onStart,
  onFinish,
  onOpenStep,
  onReportProblem,
  onRequestSupplies,
  onOpenProblem,
  onOpenChat,
}: TaskDetailProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // The question before a finish (owner, 2026-10-10): open while it is asked.
  const [isAskingToFinish, setAskingToFinish] = useState(false);
  // The main button is last: scrolled to the end it stops clear of the
  // system's bar, which the screen is drawn under (components/bottom-inset.ts).
  const end = useScreenEdgePadding(Spacing.lg);
  // The reader's words: a technician's repair is work (docs/tech-plan.md §6).
  const context = wordContext();
  const actions = availableActions(task, userId);
  const canAccept = actions.includes('accept');
  const action = actions.find((move) => move !== 'accept') ?? null;
  const isAccepted = task.status === 'accepted' && task.assignee_id === userId;
  const window = formatWindow(task);
  const place = taskPlace(task);
  // Blank as good as absent: a listing synced without a street would otherwise
  // leave an empty line where the address belongs.
  const address = place.address === null || place.address.trim() === '' ? null : place.address;
  const notes = task.property?.effective_cleaner_notes ?? null;
  const showSteps =
    steps !== undefined &&
    steps.length > 0 &&
    (task.status === 'in_progress' || task.status === 'done');
  // The office's words on this job, unless the step list on screen already
  // carries the same words as a step to tick off. The step froze them at the
  // start; if the office has rewritten them since, the current ones show here
  // too. An inspection or a midstay without a process never gets that step.
  const noteText = task.notes?.trim() ?? '';
  const isNoteOnScreenAsStep =
    showSteps &&
    (steps?.some(
      (step) => step.type === 'task_note' && (step.instructions ?? '').trim() === noteText,
    ) ??
      false);
  const taskNote = noteText !== '' && !isNoteOnScreenAsStep ? task.notes : null;
  const remaining = steps === undefined ? 0 : remainingRequired(steps);
  const isFinishBlocked = action === 'finish' && remaining > 0;
  const isStartBlocked = action === 'start' && !canStartNow(task, now);
  const isBlocked = isFinishBlocked || isStartBlocked;
  // Hers and not finished: the moment a report or a request makes sense.
  const canRaise = task.assignee_id === userId && (action === 'start' || action === 'finish');
  const fix = task.type === 'maintenance' ? (task.problem ?? null) : null;

  // A cleaning is started as a cleaning; an inspection or a repair as work.
  const actionLabel =
    action === 'claim'
      ? t('tasks.claim')
      : action === 'start'
        ? t(jobWordKey(task.type, 'start'), { context })
        : action === 'finish'
          ? t(jobWordKey(task.type, 'finish'), { context })
          : null;

  const onAction = () => {
    if (isBusy || isBlocked || action === null) {
      return;
    }
    if (action === 'claim') {
      onClaim(task.id);
    } else if (action === 'start') {
      onStart(task.id);
    } else {
      // A finish cannot be taken back: asked first, after the checks above —
      // a required step still open never gets as far as the question.
      setAskingToFinish(true);
    }
  };

  // Yes: the finish goes out as it always did — to the queue of moves, where
  // one made without signal waits for it. The dialog answers once, and a move
  // that started meanwhile, or a step reopened, still holds it.
  const onConfirmFinish = () => {
    setAskingToFinish(false);
    if (isBusy || isBlocked || action !== 'finish') {
      return;
    }
    onFinish(task.id);
  };

  const idleHint =
    task.status === 'done'
      ? t(jobWordKey(task.type, 'finished'), { context })
      : task.assignee_id !== null && task.assignee_id !== userId
        ? t(jobWordKey(task.type, 'colleague'), { context })
        : t('tasks.detail.closed', { context });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[layout.content, end]}>
      {/* Error over cache, as the lists have it: the saved task stays. This
          screen has no pull-to-refresh, so the line does not ask for one. */}
      {refreshError !== null ? (
        <ErrorBanner title={t('common.refreshFailedSaved')} error={refreshError} />
      ) : null}

      {/* The house, the room in it, and the street — read as one block, which
          is why they sit closer together than the facts below them. */}
      <View style={layout.place}>
        <Text variant="heading">{place.building}</Text>
        {place.room === null ? null : (
          <Text variant="title" tone="secondary">
            {place.room}
          </Text>
        )}
        {address === null ? null : <Text tone="secondary">{address}</Text>}
      </View>
      <Text tone="secondary">{formatScheduledDate(task)}</Text>

      <TaskFlags task={task} isUrgentFix={fix?.priority === 'high'} />

      <Card>
        {window !== null ? (
          <Fact label={t(jobWordKey(task.type, 'window'), { context })} value={window} />
        ) : null}
        {task.guests_count !== null ? (
          <Fact label={t('tasks.detail.guests')} value={String(task.guests_count)} />
        ) : null}
        {task.started_at !== null ? (
          <Fact label={t('tasks.detail.startedAt')} value={formatClockTime(task.started_at)} />
        ) : null}
        {task.completed_at !== null ? (
          <Fact label={t('tasks.detail.completedAt')} value={formatClockTime(task.completed_at)} />
        ) : null}
      </Card>

      {fix !== null ? (
        // Heard with its facts, as the report's card in her list is.
        <Card
          accessibilityLabel={[
            fix.title,
            t('problems.priorityLine', { priority: t(`problems.priorities.${fix.priority}`) }),
            t('tasks.detail.openProblem'),
          ].join('. ')}
          onPress={onOpenProblem === undefined ? undefined : () => onOpenProblem(fix.id)}
          style={layout.target}
        >
          <CardLabel text={t('tasks.detail.problem')} />
          <Text>{fix.title}</Text>
          <Text tone="secondary">
            {t('problems.priorityLine', { priority: t(`problems.priorities.${fix.priority}`) })}
            {' · '}
            {t('tasks.detail.openProblem')}
          </Text>
        </Card>
      ) : null}

      {notes !== null && notes.trim() !== '' ? (
        <NoteCard label={t('tasks.detail.notes')} text={notes} />
      ) : null}

      {/* Named as the step that carries the same words once she starts —
          in the reader's words, as `stepTitle` names the step. */}
      {taskNote !== null ? (
        <NoteCard label={t('steps.types.task_note', { context })} text={taskNote} />
      ) : null}

      {/* Not gated by canRaise: the office writes on a job before anyone
          takes it, and that note has to be readable from the queue. */}
      {onOpenChat !== undefined ? (
        <Button
          variant="outline"
          label={t('tasks.detail.openChat')}
          left={<Icon name="action.openChat" tone="primary" />}
          onPress={() => onOpenChat(task.id)}
        />
      ) : null}

      {canRaise && (onReportProblem !== undefined || onRequestSupplies !== undefined) ? (
        <View style={layout.raise}>
          {onReportProblem !== undefined ? (
            <Button
              variant="outline"
              label={t('tasks.detail.reportProblem')}
              left={<Icon name="nav.problems" tone="primary" />}
              onPress={() => onReportProblem(task.id)}
            />
          ) : null}
          {onRequestSupplies !== undefined ? (
            <Button
              variant="outline"
              label={t('tasks.detail.requestSupplies')}
              left={<Icon name="nav.supplies" tone="primary" />}
              onPress={() => onRequestSupplies(task.id)}
            />
          ) : null}
        </View>
      ) : null}

      {showSteps ? (
        <StepList
          steps={steps}
          heading={t(jobWordKey(task.type, 'steps'), { context })}
          onOpenStep={onOpenStep ?? noop}
        />
      ) : null}

      {task.is_parallel ? <Hint text={t('tasks.detail.parallel', { context })} /> : null}

      {/* The last move's failure, next to the button she retries with. */}
      {error !== null ? <FailureText error={error} /> : null}

      {isFinishBlocked ? <Hint text={t('steps.remaining', { count: remaining })} isLive /> : null}

      {isStartBlocked ? <Hint text={formatStartNotBefore(task)} isLive /> : null}

      {isAccepted ? <Hint text={t(jobWordKey(task.type, 'accepted'), { context })} isLive /> : null}

      {canAccept ? (
        // Quieter than the main button: accepting is a signal, not the job.
        <Button
          variant="secondary"
          label={t('tasks.accept')}
          isBusy={isAccepting}
          isDisabled={isBusy && !isAccepting}
          onPress={() => onAccept(task)}
        />
      ) : null}

      {actionLabel !== null ? (
        // Any move in flight — its own or the accept beside it — holds it busy
        // in its own fill rather than greying it for a moment; the window or a
        // required step greys it.
        <Button
          label={actionLabel}
          isBusy={isBusy && !isBlocked}
          isDisabled={isBlocked}
          onPress={onAction}
        />
      ) : (
        <Hint text={idleHint} />
      )}

      <ConfirmDialog
        isVisible={isAskingToFinish}
        title={t(jobWordKey(task.type, 'finishQuestion'), { context })}
        message={propertyName(task)}
        confirmLabel={t('tasks.finishConfirm')}
        onConfirm={onConfirmFinish}
        onCancel={() => setAskingToFinish(false)}
      />
    </ScrollView>
  );
}

function noop(): void {}

interface TaskFlagsProps {
  task: CleaningTask;
  /** A repair whose report the office marked high. */
  isUrgentFix: boolean;
}

/**
 * Why the job matters, as pills: the same-day check-in in the urgent tone, or
 * what kind of job it is; and on a repair the office marked high, «Срочно»
 * (docs/redesign-plan.md 2.4) — a flag of its own rather than a banner.
 */
function TaskFlags({ task, isUrgentFix }: TaskFlagsProps) {
  const { t } = useTranslation();
  const tone = isSameDayTurnover(task)
    ? STATUS_TONE['phone.checkIn.sameDay']
    : STATUS_TONE['phone.kindBanner'];

  return (
    <View style={layout.flags}>
      <Badge testID="task-urgency" label={urgencyText(task)} tone={tone} />
      {isUrgentFix ? (
        // The word the supply request uses for the same flag.
        <Badge
          testID="task-urgent"
          label={t('supplies.priorities.urgent')}
          tone={problemPriorityTone('high')}
        />
      ) : null}
    </View>
  );
}

interface FactProps {
  label: string;
  value: string;
}

/** A fact and its value on one line; at a large font the value wraps under it. */
function Fact({ label, value }: FactProps) {
  return (
    <View style={layout.fact}>
      <Text tone="secondary" style={layout.shrink}>
        {label}
      </Text>
      <Text style={layout.shrink}>{value}</Text>
    </View>
  );
}

interface CardLabelProps {
  text: string;
}

function CardLabel({ text }: CardLabelProps) {
  return (
    <Text variant="caption" tone="secondary" weight={700}>
      {text}
    </Text>
  );
}

interface NoteCardProps {
  label: string;
  text: string;
}

function NoteCard({ label, text }: NoteCardProps) {
  return (
    <Card>
      <CardLabel text={label} />
      <Text>{text}</Text>
    </Card>
  );
}

interface HintProps {
  text: string;
  /** Said aloud when it appears: it explains why the button below waits. */
  isLive?: boolean;
}

function Hint({ text, isLive = false }: HintProps) {
  return (
    <Text accessibilityLiveRegion={isLive ? 'polite' : undefined} tone="secondary" align="center">
      {text}
    </Text>
  );
}

/** The skeleton's blocks: a heading line, a line of text, a chip, the facts' card. */
const SKELETON_HEADING = 28;
const SKELETON_LINE = 16;
const SKELETON_CHIP = 20;
const SKELETON_CHIP_WIDTH = 140;
const SKELETON_CARD = 120;

interface TaskDetailSkeletonProps {
  /** What is loading, said to the reader. */
  label: string;
}

/** The shape of a task while it loads: the place, a flag, the facts, the button. */
export function TaskDetailSkeleton({ label }: TaskDetailSkeletonProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.screen}>
      <SkeletonGroup label={label} style={layout.content}>
        <Skeleton height={SKELETON_HEADING} width="70%" />
        <Skeleton height={SKELETON_LINE} width="45%" />
        <Skeleton height={SKELETON_CHIP} width={SKELETON_CHIP_WIDTH} radius={Radius.pill} />
        <Skeleton height={SKELETON_CARD} radius={Radius.card} />
        <Skeleton height={BUTTON_HEIGHT} radius={Radius.pill} />
      </SkeletonGroup>
    </View>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  place: { gap: Spacing.xs },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  fact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: Spacing.md,
  },
  shrink: { flexShrink: 1 },
  target: { minHeight: MIN_TOUCH_TARGET },
  raise: { gap: Spacing.sm },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
