import { problemStatusTone } from '@str-ops/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FontSize,
  Radius,
  Spacing,
  statusTone,
  toneChipStyles,
  type Theme,
} from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatReportedAt, problemPlace, problemPriorityText, problemStatusText } from './format';
import type { Problem } from './schema';

interface ProblemCardProps {
  problem: Problem;
  onPress: (problemId: string) => void;
  /** Somebody said something about this report that she has not read yet. */
  hasUnread?: boolean;
}

function ProblemCardComponent({ problem, onPress, hasUnread = false }: ProblemCardProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const status = problemStatusText(problem.status);
  const statusChip = styles.chip[problemStatusTone(problem.status)];
  const unreadChip = styles.chip.unread;
  const priority = problemPriorityText(problem.priority);
  const place = problemPlace(problem);
  const when = formatReportedAt(problem.created_at);
  // The mark is a fact of the card, so the reader hears it with the rest.
  const label = [
    t('problems.cardAccessibility', { title: problem.title, place, status }),
    hasUnread ? t('chat.unread') : null,
  ]
    .filter((part) => part !== null)
    .join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPress(problem.id)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {problem.title}
        </Text>
        {hasUnread ? (
          <View style={[styles.badge, unreadChip.box]}>
            <Text style={[styles.badgeText, unreadChip.label]}>{t('chat.unread')}</Text>
          </View>
        ) : null}
        <View style={[styles.badge, statusChip.box]}>
          <Text style={[styles.badgeText, statusChip.label]}>{status}</Text>
        </View>
      </View>
      <Text style={styles.meta}>
        {place} · {when}
      </Text>
      <Text style={[styles.priority, problem.priority === 'high' && styles.priorityHigh]}>
        {t('problems.priorityLine', { priority })}
      </Text>
    </Pressable>
  );
}

export const ProblemCard = memo(ProblemCardComponent);

// Each status in its own tone (STATUS_TONE), where one green chip used to say
// every status; the chips are built once per theme.
const createStyles = (theme: Theme) => ({
  chip: toneChipStyles(theme),
  ...StyleSheet.create({
    card: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.lg,
      gap: Spacing.xs,
    },
    cardPressed: { opacity: 0.8 },
    header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
    title: { flex: 1, color: theme.text, fontSize: FontSize.title, fontWeight: '700' },
    badge: {
      alignSelf: 'flex-start',
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    badgeText: { fontSize: FontSize.caption, fontWeight: '600' },
    meta: { color: theme.textSecondary, fontSize: FontSize.body },
    priority: { color: theme.textSecondary, fontSize: FontSize.caption },
    priorityHigh: { color: statusTone(theme, 'problems.priority.high').fg, fontWeight: '700' },
  }),
});
