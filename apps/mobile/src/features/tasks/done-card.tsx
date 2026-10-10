import type { TFunction } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/text';
import { ROW_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatCalendarDate, formatClockTime, propertyName } from './format';
import { calendarDay, type CleaningTask } from './schema';

interface DoneCardProps {
  task: CleaningTask;
  onPress: (taskId: string) => void;
}

/** When it was finished: the day and the time, or the planned day where no stamp was made. */
export function finishedLine(task: CleaningTask, t: TFunction): string {
  if (task.completed_at === null) {
    return t('tasks.done.completedOn', { date: formatCalendarDate(task.scheduled_date) });
  }
  return t('tasks.done.completedAt', {
    date: formatCalendarDate(calendarDay(new Date(task.completed_at))),
    time: formatClockTime(task.completed_at),
  });
}

/**
 * A finished job in «Выполненные» (owner, 2026-10-10): what it was and when it
 * was finished, one row that opens the job's own screen to read. No move of
 * its own — nothing is left to take, accept or start — and none of the open
 * list's urgency: a check-in that has passed is no longer news. A repair is
 * named by what was fixed, as on the open list.
 */
function DoneCardComponent({ task, onPress }: DoneCardProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const fix = task.type === 'maintenance' ? (task.problem ?? null) : null;
  const name = fix === null ? propertyName(task) : fix.title;
  const finished = finishedLine(task, t);
  // A repair is said with its flat: the label replaces the lines drawn on the row.
  const spoken = fix === null ? [name, finished] : [name, propertyName(task), finished];

  return (
    <Pressable
      testID="done-card"
      accessibilityRole="button"
      accessibilityLabel={spoken.join('. ')}
      onPress={() => onPress(task.id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text weight={700} numberOfLines={2}>
        {name}
      </Text>
      {fix === null ? null : (
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {propertyName(task)}
        </Text>
      )}
      <Text variant="caption" tone="secondary">
        {finished}
      </Text>
    </Pressable>
  );
}

export const DoneCard = memo(DoneCardComponent);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    // The open list's card, quieter: no window column, no button.
    card: {
      minHeight: ROW_HEIGHT,
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      backgroundColor: theme.card,
      borderRadius: Radius.card,
      boxShadow: theme.shadow,
    },
    pressed: { backgroundColor: theme.surfaceAlt },
  });
