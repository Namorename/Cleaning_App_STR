import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FontSize,
  MIN_TOUCH_TARGET,
  Radius,
  Spacing,
  statusTone,
  type Theme,
} from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { STEP_STATUS_KEY, stepStateText, stepTitle } from './format';
import { stepState, type TaskStep } from './schema';

interface StepListProps {
  steps: readonly TaskStep[];
  /**
   * Above the steps. The task knows its kind and names them — a cleaning's
   * steps, or the steps of a repair; without it, the cleaning's heading.
   */
  heading?: string;
  onOpenStep: (stepId: string) => void;
}

/**
 * The steps of a task, in order, each saying where it stands.
 *
 * Numbered by position rather than by the stored order: a step left out at
 * snapshot time (a note step on a task without a note) would otherwise leave
 * a gap in the numbering. Plain views, not a list component — a process has a
 * handful of steps and this sits inside the task's own scroll view.
 */
export function StepList({ steps, heading, onOpenStep }: StepListProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.list}>
      <Text style={styles.heading}>{heading ?? t('steps.heading')}</Text>
      {steps.map((step, index) => {
        const state = stepState(step);
        const title = stepTitle(step);
        const stateText = stepStateText(state);

        return (
          <Pressable
            key={step.id}
            accessibilityRole="button"
            accessibilityLabel={t('steps.stepAccessibility', {
              index: index + 1,
              title,
              state: stateText,
            })}
            onPress={() => onOpenStep(step.id)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={[styles.index, state === 'done' && styles.indexDone]}>
              <Text style={[styles.indexText, state === 'done' && styles.indexTextDone]}>
                {state === 'done' ? '✓' : String(index + 1)}
              </Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              <View style={styles.meta}>
                {step.required ? <Text style={styles.required}>{t('steps.required')}</Text> : null}
                <Text style={[styles.state, state === 'done' && styles.stateDone]}>{stateText}</Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const INDEX_SIZE = 28;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: Spacing.sm },
    heading: { color: theme.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
    row: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
    },
    rowPressed: { opacity: 0.85 },
    index: {
      width: INDEX_SIZE,
      height: INDEX_SIZE,
      borderRadius: INDEX_SIZE / 2,
      borderWidth: 1,
      borderColor: statusTone(theme, STEP_STATUS_KEY.pending).mark,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The step circles of the contract (STEP_CIRCLE): a ring with the number
    // to do, a filled disc with ✓ once done.
    indexDone: {
      backgroundColor: statusTone(theme, STEP_STATUS_KEY.done).mark,
      borderColor: statusTone(theme, STEP_STATUS_KEY.done).mark,
    },
    indexText: {
      color: statusTone(theme, STEP_STATUS_KEY.pending).fg,
      fontSize: FontSize.caption,
      fontWeight: '700',
    },
    indexTextDone: { color: statusTone(theme, STEP_STATUS_KEY.done).onMark },
    body: { flex: 1, gap: Spacing.xs },
    title: { color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    meta: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
    // A fact about the step, not an alarm: neutral, where it used to be red.
    required: {
      color: statusTone(theme, 'steps.required').fg,
      backgroundColor: statusTone(theme, 'steps.required').bg,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      fontSize: FontSize.caption,
      fontWeight: '600',
    },
    state: { color: theme.textSecondary, fontSize: FontSize.caption },
    stateDone: { color: statusTone(theme, STEP_STATUS_KEY.done).fg },
  });
