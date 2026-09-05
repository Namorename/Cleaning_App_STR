import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { remainingRequired, type TaskStep } from '@/features/steps/schema';
import { StepList } from '@/features/steps/step-list';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import {
  formatClockTime,
  formatScheduledDate,
  formatWindow,
  propertyName,
  urgencyText,
} from './format';
import { availableAction, isSameDayTurnover, type CleaningTask } from './schema';

interface TaskDetailProps {
  task: CleaningTask;
  userId: string;
  isBusy: boolean;
  /** The last action's failure, shown next to the button so she can retry. */
  error: Error | null;
  /** The task's process, once it has started. Undefined while loading. */
  steps?: readonly TaskStep[];
  onClaim: (taskId: string) => void;
  onStart: (taskId: string) => void;
  onFinish: (taskId: string) => void;
  onOpenStep?: (stepId: string) => void;
}

/**
 * One task, and the one thing she can do with it right now.
 *
 * Presentational: the route wires the hooks in. Exactly one action is offered
 * at a time — take, start or finish — because the database allows exactly
 * one, and a screen with two buttons where one is going to be refused is a
 * screen that lies. Once the task has started its steps sit between the facts
 * and the button; a required step still open disables the finish and says why,
 * mirroring the refusal the server would give.
 */
export function TaskDetail({
  task,
  userId,
  isBusy,
  error,
  steps,
  onClaim,
  onStart,
  onFinish,
  onOpenStep,
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
  const isFinishBlocked = action === 'finish' && remaining > 0;

  const actionLabel =
    action === 'claim'
      ? t('tasks.claim')
      : action === 'start'
        ? t('tasks.start')
        : action === 'finish'
          ? t('tasks.finish')
          : null;

  const onAction = () => {
    if (isBusy || isFinishBlocked || action === null) {
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

      {notes !== null && notes.trim() !== '' ? (
        <View style={styles.notes}>
          <Text style={styles.notesLabel}>{t('tasks.detail.notes')}</Text>
          <Text style={styles.notesText}>{notes}</Text>
        </View>
      ) : null}

      {showSteps ? <StepList steps={steps} onOpenStep={onOpenStep ?? noop} /> : null}

      {task.is_parallel ? <Text style={styles.hint}>{t('tasks.detail.parallel')}</Text> : null}

      {error !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error.message}
        </Text>
      ) : null}

      {isFinishBlocked ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {t('steps.remaining', { count: remaining })}
        </Text>
      ) : null}

      {actionLabel !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled: isBusy || isFinishBlocked, busy: isBusy }}
          disabled={isBusy || isFinishBlocked}
          onPress={onAction}
          style={({ pressed }) => [
            styles.button,
            isFinishBlocked && styles.buttonDisabled,
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
    error: { color: theme.danger, fontSize: FontSize.body, textAlign: 'center' },
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
  });
