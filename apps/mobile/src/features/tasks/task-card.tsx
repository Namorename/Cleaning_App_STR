import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, StatusColors } from '@/constants/theme';

import { formatDeadline, formatScheduledDate, propertyName } from './format';
import { isSameDayTurnover, type CleaningTask } from './schema';

interface TaskCardProps {
  task: CleaningTask;
  /** Omitted in the "my tasks" list, where there is nothing to claim. */
  onClaim?: (taskId: string) => void;
  isClaiming?: boolean;
}

function TaskCardComponent({ task, onClaim, isClaiming = false }: TaskCardProps) {
  const urgent = isSameDayTurnover(task);
  const deadline = formatDeadline(task);
  const name = propertyName(task);
  const date = formatScheduledDate(task);

  // Urgency is carried by the word "срочно" as well as the colour: a red chip
  // alone says nothing to a colour-blind user or a screen reader.
  const urgencyLabel = urgent ? 'Срочно: заезд в тот же день' : 'Обычная уборка';

  return (
    <View style={styles.card} accessible accessibilityLabel={`${name}. ${date}. ${urgencyLabel}${deadline ? `. ${deadline}` : ''}`}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <View style={[styles.chip, urgent ? styles.chipUrgent : styles.chipCalm]}>
          <Text style={[styles.chipText, urgent ? styles.chipTextUrgent : styles.chipTextCalm]}>
            {urgent ? 'Срочно' : 'Обычная'}
          </Text>
        </View>
      </View>

      <Text style={styles.meta}>
        {date}
        {deadline ? ` · ${deadline}` : ''}
      </Text>

      {onClaim ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Взять уборку: ${name}, ${date}`}
          accessibilityState={{ disabled: isClaiming, busy: isClaiming }}
          disabled={isClaiming}
          onPress={() => onClaim(task.id)}
          style={({ pressed }) => [styles.claim, pressed && styles.claimPressed]}
        >
          {isClaiming ? <ActivityIndicator /> : <Text style={styles.claimText}>Взять</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

export const TaskCard = memo(TaskCardComponent);

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D6D8DE',
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  name: {
    flex: 1,
    fontSize: FontSize.title,
    fontWeight: '600',
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
  },
  chipUrgent: { backgroundColor: StatusColors.urgentSurface },
  chipCalm: { backgroundColor: StatusColors.calmSurface },
  chipText: { fontSize: FontSize.caption, fontWeight: '600' },
  chipTextUrgent: { color: StatusColors.urgent },
  chipTextCalm: { color: StatusColors.calm },
  meta: {
    fontSize: FontSize.body,
    color: '#60646C',
  },
  claim: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.md,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  claimPressed: { opacity: 0.75 },
  claimText: {
    color: '#FFFFFF',
    fontSize: FontSize.title,
    fontWeight: '600',
  },
});
