import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { remainingRequired, type TaskStep } from '@/features/steps/schema';
import { StepList } from '@/features/steps/step-list';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import {
  formatClockTime,
  formatScheduledDate,
  formatStartNotBefore,
  formatWindow,
  propertyName,
  urgencyText,
} from './format';
import { availableAction, canStartNow, isSameDayTurnover, type CleaningTask } from './schema';

interface TaskDetailProps {
  task: CleaningTask;
  userId: string;
  /** The clock the start button is judged against; ticks in the route. */
  now: Date;
  isBusy: boolean;
  /** The last action's failure, shown next to the button so she can retry. */
  error: Error | null;
  /** The task's process, once it has started. Undefined while loading. */
  steps?: readonly TaskStep[];
  onClaim: (taskId: string) => void;
  onStart: (taskId: string) => void;
  onFinish: (taskId: string) => void;
  onOpenStep?: (stepId: string) => void;
  /** Offered while the task is hers and open: something is broken, or running out. */
  onReportProblem?: (taskId: string) => void;
  onRequestSupplies?: (taskId: string) => void;
  /** On a maintenance task: the report it fixes. */
  onOpenProblem?: (problemId: string) => void;
}

/**
 * One task, and the one thing she can do with it right now.
 *
 * Presentational: the route wires the hooks in. Exactly one action is offered
 * at a time — take, start or finish — because the database allows exactly
 * one, and a screen with two buttons where one is going to be refused is a
 * screen that lies. Once the task has started its steps sit between the facts
 * and the button; a required step still open disables the finish and says why,
 * mirroring the refusal the server would give. The start is held the same way
 * until the cleaning window opens.
 */
export function TaskDetail({
  task,
  userId,
  now,
  isBusy,
  error,
  steps,
  onClaim,
  onStart,
  onFinish,
  onOpenStep,
  onReportProblem,
  onRequestSupplies,
  onOpenProblem,
}: TaskDetailProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const action = availableAction(task, userId);
  const urgent = isSameDayTurnover(task);
  const window = formatWindow(task);
  const notes = task.property?.cleaner_notes ?? null;
  const showSteps =
    steps !== undefined &&
    steps.length > 0 &&
    (task.status === 'in_progress' || task.status === 'done');
  const remaining = steps === undefined ? 0 : remainingRequired(steps);
  const failure = error === null ? null : serverErrorText(error);
  const isFinishBlocked = action === 'finish' && remaining > 0;
  const isStartBlocked = action === 'start' && !canStartNow(task, now);
  const isBlocked = isFinishBlocked || isStartBlocked;
  // Hers and not finished: the moment a report or a request makes sense.
  const canRaise = task.assignee_id === userId && (action === 'start' || action === 'finish');
  const fix = task.type === 'maintenance' ? (task.problem ?? null) : null;

  const actionLabel =
    action === 'claim'
      ? t('tasks.claim')
      : action === 'start'
        ? t('tasks.start')
        : action === 'finish'
          ? t('tasks.finish')
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
      onFinish(task.id);
    }
  };

  const idleHint =
    task.status === 'done'
      ? t('tasks.detail.finished')
      : task.assignee_id !== null && task.assignee_id !== userId
        ? t('tasks.detail.colleague')
        : t('tasks.detail.closed');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{propertyName(task)}</Text>
      <Text style={styles.meta}>{formatScheduledDate(task)}</Text>

      <View style={[styles.banner, urgent ? styles.bannerUrgent : styles.bannerCalm]}>
        <Text style={[styles.bannerText, urgent ? styles.bannerTextUrgent : styles.bannerTextCalm]}>
          {urgencyText(task)}
        </Text>
      </View>

      <View style={styles.facts}>
        {window !== null ? (
          <Fact label={t('tasks.detail.window')} value={window} styles={styles} />
        ) : null}
        {task.guests_count !== null ? (
          <Fact label={t('tasks.detail.guests')} value={String(task.guests_count)} styles={styles} />
        ) : null}
        {task.started_at !== null ? (
          <Fact
            label={t('tasks.detail.startedAt')}
            value={formatClockTime(task.started_at)}
            styles={styles}
          />
        ) : null}
        {task.completed_at !== null ? (
          <Fact
            label={t('tasks.detail.completedAt')}
            value={formatClockTime(task.completed_at)}
            styles={styles}
          />
        ) : null}
      </View>

      {fix !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tasks.detail.openProblem')}
          disabled={onOpenProblem === undefined}
          onPress={() => onOpenProblem?.(fix.id)}
          style={({ pressed }) => [styles.notes, pressed && styles.buttonPressed]}
        >
          <Text style={styles.notesLabel}>{t('tasks.detail.problem')}</Text>
          <Text style={styles.notesText}>{fix.title}</Text>
          <Text style={styles.meta}>
            {t('problems.priorityLine', { priority: t(`problems.priorities.${fix.priority}`) })}
            {' · '}
            {t('tasks.detail.openProblem')}
          </Text>
        </Pressable>
      ) : null}

      {notes !== null && notes.trim() !== '' ? (
        <View style={styles.notes}>
          <Text style={styles.notesLabel}>{t('tasks.detail.notes')}</Text>
          <Text style={styles.notesText}>{notes}</Text>
        </View>
      ) : null}

      {canRaise && (onReportProblem !== undefined || onRequestSupplies !== undefined) ? (
        <View style={styles.raise}>
          {onReportProblem !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('tasks.detail.reportProblem')}
              onPress={() => onReportProblem(task.id)}
              style={({ pressed }) => [styles.secondary, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryText}>{t('tasks.detail.reportProblem')}</Text>
            </Pressable>
          ) : null}
          {onRequestSupplies !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('tasks.detail.requestSupplies')}
              onPress={() => onRequestSupplies(task.id)}
              style={({ pressed }) => [styles.secondary, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryText}>{t('tasks.detail.requestSupplies')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showSteps ? <StepList steps={steps} onOpenStep={onOpenStep ?? noop} /> : null}

      {task.is_parallel ? <Text style={styles.hint}>{t('tasks.detail.parallel')}</Text> : null}

      {failure !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.failure}>
          <Text style={styles.error}>{failure.text}</Text>
          {failure.detail !== null ? (
            <Text style={styles.errorDetail}>{failure.detail}</Text>
          ) : null}
        </View>
      ) : null}

      {isFinishBlocked ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {t('steps.remaining', { count: remaining })}
        </Text>
      ) : null}

      {isStartBlocked ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {formatStartNotBefore(task)}
        </Text>
      ) : null}

      {actionLabel !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled: isBusy || isBlocked, busy: isBusy }}
          disabled={isBusy || isBlocked}
          onPress={onAction}
          style={({ pressed }) => [
            styles.button,
            isBlocked && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {isBusy ? (
            <ActivityIndicator color={styles.buttonText.color} />
          ) : (
            <Text style={styles.buttonText}>{actionLabel}</Text>
          )}
        </Pressable>
      ) : (
        <Text style={styles.hint}>{idleHint}</Text>
      )}
    </ScrollView>
  );
}

function noop(): void {}

interface FactProps {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}

function Fact({ label, value, styles }: FactProps) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.md },
    name: { color: theme.text, fontSize: FontSize.heading, fontWeight: '700' },
    meta: { color: theme.textSecondary, fontSize: FontSize.body },
    banner: { borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
    bannerUrgent: { backgroundColor: theme.urgentSurface },
    bannerCalm: { backgroundColor: theme.calmSurface },
    bannerText: { fontSize: FontSize.body, fontWeight: '600' },
    bannerTextUrgent: { color: theme.urgentText },
    bannerTextCalm: { color: theme.calmText },
    facts: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.lg,
      gap: Spacing.sm,
    },
    fact: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
    factLabel: { color: theme.textSecondary, fontSize: FontSize.body },
    factValue: { color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    notes: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.lg,
      gap: Spacing.xs,
    },
    notesLabel: { color: theme.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
    notesText: { color: theme.text, fontSize: FontSize.body },
    hint: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
    failure: { gap: Spacing.xs },
    error: { color: theme.danger, fontSize: FontSize.body, textAlign: 'center' },
    errorDetail: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'center' },
    button: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonDisabled: { opacity: 0.5 },
    buttonPressed: { opacity: 0.75 },
    buttonText: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
    raise: { gap: Spacing.sm },
    secondary: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: { color: theme.primary, fontSize: FontSize.title, fontWeight: '600' },
  });
