import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatScheduledDate, formatWindow, propertyName, taskPlace, urgencyText } from './format';
import { isRunning, isSameDayTurnover, type CleaningTask } from './schema';

interface TaskCardProps {
  task: CleaningTask;
  /** Omitted in the "my tasks" list, where there is nothing to claim. */
  onClaim?: (taskId: string) => void;
  /** Opens the task. Omitted where the card is not a link. */
  onPress?: (taskId: string) => void;
  isClaiming?: boolean;
  /** Somebody said something about this job that she has not read yet. */
  hasUnread?: boolean;
}

function TaskCardComponent({
  task,
  onClaim,
  onPress,
  isClaiming = false,
  hasUnread = false,
}: TaskCardProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const urgent = isSameDayTurnover(task);
  const running = isRunning(task);
  const fix = task.type === 'maintenance' ? (task.problem ?? null) : null;
  const place = taskPlace(task);
  // A fix is named by what is broken; the flat is the second line.
  const name = fix === null ? place.building : fix.title;
  // The room under the house, on a cleaning of a multi-unit listing. A fix
  // already carries the whole place in its banner, and repeating it under the
  // title of the problem would say the same thing twice.
  const room = fix === null ? place.room : null;
  // Spoken as one line: a screen reader gets no second line for free, and
  // "1 - 2109" without its house is the one thing this card must not say.
  const spoken = fix === null ? propertyName(task) : fix.title;
  const date = formatScheduledDate(task);
  const window = formatWindow(task);
  // Colour repeats what the line says; it never carries the meaning alone.
  const urgency =
    fix === null
      ? urgencyText(task)
      : t('tasks.detail.fixBanner', {
          property: propertyName(task),
          priority: t(`problems.priorities.${fix.priority}`),
        });

  const body = (
    <>
      {/* The house and the room in it are one block: the card's even spacing
          would otherwise read the room as just another line of metadata.
          Two lines each — a room can be called "Unit 8 - 3rd floor", and the
          system font can be set large. */}
      <View style={styles.place}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>
          {hasUnread ? (
            <View style={styles.unread}>
              <Text style={styles.unreadText}>{t('chat.unread')}</Text>
            </View>
          ) : null}
          {running ? (
            <View style={styles.status}>
              <Text style={styles.statusText}>{t('tasks.status.inProgress')}</Text>
            </View>
          ) : null}
        </View>

        {room === null ? null : (
          <Text style={styles.room} numberOfLines={2}>
            {room}
          </Text>
        )}
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
          accessibilityLabel={t('tasks.claimAccessibility', { property: spoken, date })}
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

  // The mark is a fact of the card, so the reader hears it with the rest.
  const label = [
    t('tasks.cardAccessibility', { property: spoken, date, urgency }),
    hasUnread ? t('chat.unread') : null,
  ]
    .filter((part) => part !== null)
    .join('. ');

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
    place: { gap: Spacing.xs },
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
    // Which flat inside the house — a fact of the same weight as the house,
    // one step quieter so the two read as one address rather than two names.
    room: {
      color: theme.textSecondary,
      fontSize: FontSize.body,
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
    // Quieter than "in progress": a word waiting for her, not the state of the job.
    unread: {
      backgroundColor: theme.calmSurface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    unreadText: {
      color: theme.calmText,
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
