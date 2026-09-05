import type { Json } from '@str-ops/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { formatClockTime } from '@/features/tasks/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { stepStateText, stepTitle } from './format';
import { checkedLines, commentText, noteLines, stepState, type TaskStep } from './schema';
import { StepComment } from './step-comment';
import { StepTaskNote } from './step-task-note';

interface StepScreenProps {
  step: TaskStep;
  /** Her own task, still in progress. Otherwise the step is read-only. */
  isEditable: boolean;
  isBusy: boolean;
  error: Error | null;
  onComplete: (payload: Json) => void;
  onReopen: () => void;
  onSkip: () => void;
}

/**
 * One step, and what the cleaner can do with it.
 *
 * Presentational: the route wires the hooks in and decides what happens after
 * a tap. The body depends on the type; the actions depend on the state — a
 * pending step is completed (or skipped, if optional), a done or skipped one
 * can be taken back, a waived one is left as the manager left it, and a step
 * of a type this build does not know explains itself.
 */
export function StepScreen({
  step,
  isEditable,
  isBusy,
  error,
  onComplete,
  onReopen,
  onSkip,
}: StepScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const state = stepState(step);
  const lines = noteLines(step.instructions);
  const [checked, setChecked] = useState<number[]>(() => checkedLines(step));
  const [comment, setComment] = useState(() => commentText(step));

  const isPending = state === 'pending';
  const canAct = isEditable && !isBusy;
  const canComplete =
    canAct &&
    isPending &&
    (step.type === 'confirmation' ||
      (step.type === 'task_note' && lines.every((_, index) => checked.includes(index))) ||
      (step.type === 'cleaner_comment' && comment.trim() !== ''));

  const toggleLine = (index: number) => {
    setChecked((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );
  };

  const complete = () => {
    if (!canComplete) {
      return;
    }
    if (step.type === 'task_note') {
      onComplete({ checked_lines: [...checked].sort((a, b) => a - b) });
    } else if (step.type === 'cleaner_comment') {
      onComplete({ text: comment.trim() });
    } else {
      onComplete({});
    }
  };

  const statusLine =
    state === 'done' && step.completed_at !== null
      ? t('steps.completedAt', { time: formatClockTime(step.completed_at) })
      : state === 'waived'
        ? t('steps.waivedBy', { reason: step.waive_reason ?? '' })
        : state === 'skipped' || state === 'unsupported'
          ? stepStateText(state)
          : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{stepTitle(step)}</Text>
        {step.required ? <Text style={styles.required}>{t('steps.required')}</Text> : null}
      </View>

      {statusLine !== null ? <Text style={styles.status}>{statusLine}</Text> : null}

      {state === 'unsupported' ? (
        <Text style={styles.hint}>{t('steps.unsupported')}</Text>
      ) : step.type === 'task_note' ? (
        <>
          <Text style={styles.hint}>{t('steps.noteHint')}</Text>
          <StepTaskNote
            lines={lines}
            checked={checked}
            onToggle={toggleLine}
            disabled={!canAct || !isPending}
          />
        </>
      ) : step.type === 'cleaner_comment' ? (
        <StepComment
          value={comment}
          onChangeText={setComment}
          disabled={!canAct || !isPending}
        />
      ) : step.instructions !== null && step.instructions.trim() !== '' ? (
        <View style={styles.instructions}>
          {noteLines(step.instructions).map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.instructionLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {error !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error.message}
        </Text>
      ) : null}

      {!isEditable ? <Text style={styles.hint}>{t('steps.readOnly')}</Text> : null}

      {isEditable && isPending ? (
        <ActionButton
          label={step.type === 'cleaner_comment' ? t('steps.save') : t('steps.done')}
          onPress={complete}
          disabled={!canComplete}
          isBusy={isBusy}
          styles={styles}
        />
      ) : null}

      {isEditable && (isPending || state === 'unsupported') && !step.required ? (
        <ActionButton
          label={t('steps.skip')}
          onPress={onSkip}
          disabled={!canAct}
          isBusy={false}
          secondary
          styles={styles}
        />
      ) : null}

      {isEditable && (state === 'done' || state === 'skipped') ? (
        <ActionButton
          label={t('steps.reopen')}
          onPress={onReopen}
          disabled={!canAct}
          isBusy={isBusy}
          secondary
          styles={styles}
        />
      ) : null}
    </ScrollView>
  );
}

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  disabled: boolean;
  isBusy: boolean;
  secondary?: boolean;
  styles: ReturnType<typeof createStyles>;
}

function ActionButton({
  label,
  onPress,
  disabled,
  isBusy,
  secondary = false,
  styles,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: isBusy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {isBusy ? (
        <ActivityIndicator
          color={secondary ? styles.buttonSecondaryText.color : styles.buttonText.color}
        />
      ) : (
        <Text style={secondary ? styles.buttonSecondaryText : styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.md },
    header: { gap: Spacing.xs },
    title: { color: theme.text, fontSize: FontSize.heading, fontWeight: '700' },
    required: {
      alignSelf: 'flex-start',
      color: theme.urgentText,
      backgroundColor: theme.urgentSurface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      fontSize: FontSize.caption,
      fontWeight: '600',
    },
    status: { color: theme.calmText, fontSize: FontSize.body, fontWeight: '600' },
    hint: { color: theme.textSecondary, fontSize: FontSize.body },
    instructions: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.lg,
      gap: Spacing.sm,
    },
    instructionLine: { color: theme.text, fontSize: FontSize.title },
    error: { color: theme.danger, fontSize: FontSize.body, textAlign: 'center' },
    button: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonSecondary: {
      backgroundColor: theme.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonPressed: { opacity: 0.75 },
    buttonText: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
    buttonSecondaryText: { color: theme.primary, fontSize: FontSize.title, fontWeight: '600' },
  });
