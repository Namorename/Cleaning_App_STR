import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatScheduledDate, formatWindow, propertyName, urgencyText } from './format';
import { isRunning, isSameDayTurnover, type CleaningTask } from './schema';

interface TaskCardProps {
  task: CleaningTask;
  /** Omitted in the "my tasks" list, where there is nothing to claim. */
  onClaim?: (taskId: string) => void;
  /** Opens the task. Omitted where the card is not a link. */
  onPress?: (taskId: string) => void;
  isClaiming?: boolean;
}

function TaskCardComponent({ task, onClaim, onPress, isClaiming = false }: TaskCardProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const urgent = isSameDayTurnover(task);
  const running = isRunning(task);
  const name = propertyName(task);
  const date = formatScheduledDate(task);
  const window = formatWindow(task);
  // Colour repeats what the line says; it never carries the meaning alone.
  const urgency = urgencyText(task);

  const body = (
    <>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        {running ? (
          <View style={styles.status}>
            <Text style={styles.statusText}>{t('tasks.status.inProgress')}</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.meta}>
        {date}
        {window === null ? '' : ` · ${window}`}
      </Text>

      <View style={[styles.banner, urgent ? styles.bannerUrgent : styles.bannerCalm]}>
        <Text style={[styles.bannerText, urgent ? styles.bannerTextUrgent : styles.bannerTextCalm]}>
          {urgency}
        </Text>
      </View>

      {onClaim ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tasks.claimAccessibility', { property: name, date })}
          accessibilityState={{ disabled: isClaiming, busy: isClaiming }}
          disabled={isClaiming}
          onPress={() => onClaim(task.id)}
          style={({ pressed }) => [styles.claim, pressed && styles.claimPressed]}
        >
          {isClaiming ? (
            <ActivityIndicator color={styles.claimText.color} />
          ) : (
            <Text style={styles.claimText}>{t('tasks.claim')}</Text>
          )}
        </Pressable>
      ) : null}
    </>
  );

  const label = t('tasks.cardAccessibility', { property: name, date, urgency });

  if (onPress === undefined) {
    return (
      <View style={styles.card} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPress(task.id)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {body}
    </Pressable>
  );
}

export const TaskCard = memo(TaskCardComponent);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.lg,
      gap: Spacing.sm,
    },
    cardPressed: { opacity: 0.85 },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
    },
    name: {
      flex: 1,
      color: theme.text,
      fontSize: FontSize.title,
      fontWeight: '600',
    },
    status: {
      backgroundColor: theme.primary,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    statusText: {
      color: theme.onPrimary,
      fontSize: FontSize.caption,
      fontWeight: '600',
    },
    meta: {
      color: theme.textSecondary,
      fontSize: FontSize.body,
    },
    banner: {
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    bannerUrgent: { backgroundColor: theme.urgentSurface },
    bannerCalm: { backgroundColor: theme.calmSurface },
    bannerText: { fontSize: FontSize.body, fontWeight: '600' },
    bannerTextUrgent: { color: theme.urgentText },
    bannerTextCalm: { color: theme.calmText },
    claim: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.xs,
    },
    claimPressed: { opacity: 0.75 },
    claimText: {
      color: theme.onPrimary,
      fontSize: FontSize.title,
      fontWeight: '600',
    },
  });
