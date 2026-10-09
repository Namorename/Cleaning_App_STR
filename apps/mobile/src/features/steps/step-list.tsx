import { STATUS_TONE, STEP_CIRCLE, type StepCircle } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { ROW_HEIGHT, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { STEP_STATUS_KEY, stepStateText, stepTitle } from './format';
import { stepState, type StepState, type TaskStep } from './schema';

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
 *
 * Each step is a card — its name over a line of badges — opened as one
 * button, and read as one sentence: number, name, state.
 */
export function StepList({ steps, heading, onOpenStep }: StepListProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.list}>
      <Text variant="caption" tone="secondary" weight={700} accessibilityRole="header">
        {heading ?? t('steps.heading')}
      </Text>
      {steps.map((step, index) => {
        const state = stepState(step);
        const title = stepTitle(step);
        const stateText = stepStateText(state);

        return (
          <Card
            key={step.id}
            accessibilityLabel={t('steps.stepAccessibility', {
              index: index + 1,
              title,
              state: stateText,
            })}
            onPress={() => onOpenStep(step.id)}
            style={styles.row}
          >
            <StepMark state={state} number={index + 1} />
            <View style={styles.body}>
              <Text numberOfLines={2}>{title}</Text>
              <View style={styles.badges}>
                {step.required ? (
                  <Badge
                    testID="step-required"
                    label={t('steps.required')}
                    tone={STATUS_TONE['steps.required']}
                  />
                ) : null}
                <Badge
                  testID="step-state"
                  label={stateText}
                  tone={STATUS_TONE[STEP_STATUS_KEY[state]]}
                />
              </View>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

interface StepMarkProps {
  state: StepState;
  number: number;
}

/**
 * The step's circle of the contract (`STEP_CIRCLE`), by the tone of its state:
 * a ring with the number to do, a filled disc with ✓ once done, a ring with ✕
 * when skipped or waived. It grows with the system font rather than cut the
 * number.
 */
function StepMark({ state, number }: StepMarkProps) {
  const theme = useTheme();
  const tone = STATUS_TONE[STEP_STATUS_KEY[state]];
  const circle: StepCircle = STEP_CIRCLE[tone];
  const colors = theme.tone[tone];
  const ink = circle.glyphColor === 'onMark' ? (colors.onMark ?? colors.fg) : colors.fg;
  const drawn: ViewStyle =
    circle.draw === 'disc'
      ? { backgroundColor: colors.mark }
      : { borderWidth: circle.ringWidth, borderColor: colors.mark };

  return (
    <View style={[styles.mark, drawn]}>
      {circle.glyph === 'number' ? (
        <Text variant="chip" color={ink}>
          {String(number)}
        </Text>
      ) : (
        <Icon testID="step-glyph" name={circle.glyph} size="small" color={ink} />
      )}
    </View>
  );
}

const MARK_SIZE = 28;

/** Sizes only: the colours are the tones'. */
const styles = StyleSheet.create({
  list: { gap: Spacing.sm },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  mark: {
    minWidth: MARK_SIZE,
    minHeight: MARK_SIZE,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: Spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
});
