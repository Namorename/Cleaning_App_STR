import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FontSize,
  MIN_TOUCH_TARGET,
  Radius,
  Spacing,
  statusTone,
  type Theme,
} from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatScheduledDate, formatWindow, propertyName, taskPlace, urgencyText } from './format';
import { isRunning, isSameDayTurnover, type CleaningTask } from './schema';

interface TaskCardProps {
  task: CleaningTask;
  /** Omitted in the "My cleanings" list, where there is nothing to claim. */
  onClaim?: (taskId: string) => void;
  /** Offered in her own list, on a cleaning she has not accepted yet; gets it as shown. */
  onAccept?: (task: CleaningTask) => void;
  /** Opens the task. Omitted where the card is not a link. */
  onPress?: (taskId: string) => void;
  isClaiming?: boolean;
  isAccepting?: boolean;
  /** Somebody said something about this job that she has not read yet. */
  hasUnread?: boolean;
}

function TaskCardComponent({
  task,
  onClaim,
  onAccept,
  onPress,
  isClaiming = false,
  isAccepting = false,
  hasUnread = false,
}: TaskCardProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const urgent = isSameDayTurnover(task);
  const running = isRunning(task);
  // Hers already: the list only ever holds her own work, so the status says it.
  const accepted = task.status === 'accepted';
  // Only what she has not accepted yet; the queue never passes it.
  const accept = task.status === 'assigned' ? onAccept : undefined;
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

  const summary = (
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
          {accepted ? (
            <View style={styles.accepted}>
              <Text style={styles.acceptedText}>{t('tasks.status.accepted')}</Text>
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

      <View style={[styles.banner, urgent ? styles.bannerUrgent : styles.bannerNeutral]}>
        <Text
          style={[styles.bannerText, urgent ? styles.bannerTextUrgent : styles.bannerTextNeutral]}
        >
          {urgency}
        </Text>
      </View>

    </>
  );

  // The mark is a fact of the card, so the reader hears it with the rest.
  const label = [
    t('tasks.cardAccessibility', { property: spoken, date, urgency }),
    accepted ? t('tasks.status.accepted') : null,
    hasUnread ? t('chat.unread') : null,
  ]
    .filter((part) => part !== null)
    .join('. ');

  // The facts are read as one element, and opened as one where the card is a
  // link. "Take" sits beside them, never inside: VoiceOver reads a grouped
  // element whole, and a button inside one is out of its reach — on the
  // queue, where the card both opens and is taken, that was the button.
  const facts =
    onPress === undefined ? (
      <View style={styles.summary} accessible accessibilityLabel={label}>
        {summary}
      </View>
    ) : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => onPress(task.id)}
        style={({ pressed }) => [styles.summary, pressed && styles.cardPressed]}
      >
        {summary}
      </Pressable>
    );

  return (
    <View style={styles.card}>
      {facts}
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
      {/* Beside the facts like "take", and quieter: a signal, not the job. */}
      {accept !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tasks.acceptAccessibility', { property: spoken, date })}
          accessibilityState={{ disabled: isAccepting, busy: isAccepting }}
          disabled={isAccepting}
          onPress={() => accept(task)}
          style={({ pressed }) => [styles.accept, pressed && styles.claimPressed]}
        >
          {isAccepting ? (
            <ActivityIndicator color={styles.acceptText.color} />
          ) : (
            <Text style={styles.acceptText}>{t('tasks.accept')}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
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
    // The same rhythm inside the facts as between them and "take".
    summary: { gap: Spacing.sm },
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
    // The tones are the contract's (STATUS_TONE): work under way is amber,
    // accepted is "assigned" blue, a new message the unread badge.
    status: {
      backgroundColor: statusTone(theme, 'tasks.in_progress').bg,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    statusText: {
      color: statusTone(theme, 'tasks.in_progress').fg,
      fontSize: FontSize.caption,
      fontWeight: '600',
    },
    // A state of the job like "in progress", and quieter: her word to the
    // office, drawn as an outline rather than as the filled mark of work under way.
    accepted: {
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: statusTone(theme, 'tasks.accepted').border,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    acceptedText: {
      color: statusTone(theme, 'tasks.accepted').fg,
      fontSize: FontSize.caption,
      fontWeight: '600',
    },
    // A word waiting for her, not the state of the job.
    unread: {
      backgroundColor: statusTone(theme, 'chat.unread').bg,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    unreadText: {
      color: statusTone(theme, 'chat.unread').fg,
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
    // A same-day check-in is urgent; no check-in, or the job's own name, is
    // neutral — it used to be green, the colour of "done".
    bannerUrgent: { backgroundColor: statusTone(theme, 'phone.checkIn.sameDay').bg },
    bannerNeutral: { backgroundColor: statusTone(theme, 'phone.kindBanner').bg },
    bannerText: { fontSize: FontSize.body, fontWeight: '600' },
    bannerTextUrgent: { color: statusTone(theme, 'phone.checkIn.sameDay').fg },
    bannerTextNeutral: { color: statusTone(theme, 'phone.kindBanner').fg },
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
    accept: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.xs,
    },
    acceptText: {
      color: theme.primary,
      fontSize: FontSize.title,
      fontWeight: '600',
    },
  });
