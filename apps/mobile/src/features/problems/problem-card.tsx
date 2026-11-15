import { STATUS_TONE, problemLevel, problemStatusTone } from '@str-ops/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

import {
  formatReportedAt,
  problemPlace,
  problemPriorityText,
  problemStatusText,
  urgencyChip,
} from './format';
import type { Problem } from './schema';
import {
  SIGNAL_BADGE_TONE,
  shownTitle,
  signalBadges,
  signalLabel,
  signalSource,
  signalSourceWord,
} from './signal-source';
import { SourceBadge } from './source-badge';

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
 * supply request use for the same flag — and one of the level above high
 * «Критическая», filled in the strongest tone (owner, 2026-11-15). A task a guest's review or chat made
 * leads its pills with the source chip (`SourceBadge`, owner 2026-11-11).
 */
function ProblemCardComponent({ problem, onPress, hasUnread = false }: ProblemCardProps) {
  const { t, i18n } = useTranslation();
  const status = problemStatusText(problem.status);
  const level = problemLevel(problem);
  const urgent = urgencyChip(level);
  const place = problemPlace(problem);
  const title = shownTitle(problem, i18n.language);
  const source = signalSource(problem);
  const signal = signalLabel(problem, t);
  const plaques = signalBadges(problem, t);
  const when = formatReportedAt(problem.created_at);
  // The marks are facts of the card, so the reader hears them with the rest.
  const label = [
    t('problems.cardAccessibility', { title, place, status }),
    signalSourceWord(problem, t),
    signal,
    ...plaques,
    urgent?.label ?? null,
    hasUnread ? t('chat.unread') : null,
  ]
    .filter((part) => part !== null)
    .join('. ');

  return (
    <Card accessibilityLabel={label} onPress={() => onPress(problem.id)}>
      <Text variant="title" numberOfLines={2}>
        {title}
      </Text>
      {signal === null ? null : <Text tone="secondary">{signal}</Text>}
      <View testID="problem-marks" style={styles.marks}>
        {source === null ? null : <SourceBadge testID="problem-source" source={source} />}
        {hasUnread ? <Badge label={t('chat.unread')} tone={STATUS_TONE['chat.unread']} /> : null}
        <Badge testID="problem-status" label={status} tone={problemStatusTone(problem.status)} />
        {urgent === null ? null : (
          <Badge testID="problem-urgent" label={urgent.label} tone={urgent.tone} />
        )}
        {plaques.map((plaque) => (
          <Badge key={plaque} label={plaque} tone={SIGNAL_BADGE_TONE} />
        ))}
      </View>
      <Text tone="secondary">
        {place} · {when}
      </Text>
      {urgent !== null ? null : (
        <Text variant="caption" tone="secondary">
          {t('problems.priorityLine', { priority: problemPriorityText(level) })}
        </Text>
      )}
    </Card>
  );
}

export const ProblemCard = memo(ProblemCardComponent);

/** Sizes only: the colours are the components'. */
const styles = StyleSheet.create({
  // The pills under the title — where a guest's task came from first, then the
  // new-message mark as before — wrapping when they do not fit: beside it, at
  // 320 dp and a large font, they left the title a sliver of the card.
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
});
