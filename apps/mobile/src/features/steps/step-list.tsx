import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { stepStateText, stepTitle } from './format';
import { stepState, type TaskStep } from './schema';

interface StepListProps {
  steps: readonly TaskStep[];
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
export function StepList({ steps, onOpenStep }: StepListProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.list}>
      <Text style={styles.heading}>{t('steps.heading')}</Text>
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
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    indexDone: { backgroundColor: theme.calmSurface, borderColor: theme.calmSurface },
    indexText: { color: theme.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
    indexTextDone: { color: theme.calmText },
    body: { flex: 1, gap: Spacing.xs },
    title: { color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    meta: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
    required: {
      color: theme.urgentText,
      backgroundColor: theme.urgentSurface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      fontSize: FontSize.caption,
      fontWeight: '600',
    },
    state: { color: theme.textSecondary, fontSize: FontSize.caption },
    stateDone: { color: theme.calmText },
  });
