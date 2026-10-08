import { STATUS_TONE, problemPriorityTone, problemStatusTone } from '@str-ops/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

import { formatReportedAt, problemPlace, problemPriorityText, problemStatusText } from './format';
import type { Problem } from './schema';

interface ProblemCardProps {
  problem: Problem;
  onPress: (problemId: string) => void;
  /** Somebody said something about this report that she has not read yet. */
  hasUnread?: boolean;
}

/**
 * A report in her list: one card, one button. The status is a pill in its own
 * tone (STATUS_TONE), where one green chip used to say every status; a report
 * the office must see first carries «Срочно» in the urgent tone instead of a
 * red line (docs/redesign-plan.md 2.4) — the word the task screen and the
 * supply request use for the same flag.
 */
function ProblemCardComponent({ problem, onPress, hasUnread = false }: ProblemCardProps) {
  const { t } = useTranslation();
  const status = problemStatusText(problem.status);
  const isUrgent = problem.priority === 'high';
  const urgent = t('supplies.priorities.urgent');
  const place = problemPlace(problem);
  const when = formatReportedAt(problem.created_at);
  // The marks are facts of the card, so the reader hears them with the rest.
  const label = [
    t('problems.cardAccessibility', { title: problem.title, place, status }),
    isUrgent ? urgent : null,
    hasUnread ? t('chat.unread') : null,
  ]
    .filter((part) => part !== null)
    .join('. ');

  return (
    <Card accessibilityLabel={label} onPress={() => onPress(problem.id)}>
      <View style={styles.header}>
        <Text variant="title" numberOfLines={2} style={styles.title}>
          {problem.title}
        </Text>
        <View style={styles.marks}>
          {hasUnread ? <Badge label={t('chat.unread')} tone={STATUS_TONE['chat.unread']} /> : null}
          <Badge testID="problem-status" label={status} tone={problemStatusTone(problem.status)} />
          {isUrgent ? (
            <Badge testID="problem-urgent" label={urgent} tone={problemPriorityTone('high')} />
          ) : null}
        </View>
      </View>
      <Text tone="secondary">
        {place} · {when}
      </Text>
      {isUrgent ? null : (
        <Text variant="caption" tone="secondary">
          {t('problems.priorityLine', { priority: problemPriorityText(problem.priority) })}
        </Text>
      )}
    </Card>
  );
}

export const ProblemCard = memo(ProblemCardComponent);

/** Sizes only: the colours are the components'. */
const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  title: { flex: 1 },
  // The pills stack at the right, the new-message mark first as before: in a
  // row, three of them would leave the title no room at 320 dp.
  marks: { gap: Spacing.xs },
});
