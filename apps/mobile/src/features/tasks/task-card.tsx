import { SIZE, STATUS_TONE, problemPriorityTone, taskStatusTone } from '@str-ops/shared';
import type { TFunction } from 'i18next';
import { memo, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import {
  BUTTON_HEIGHT,
  ROW_HEIGHT,
  Radius,
  Spacing,
  statusTone,
  type Theme,
} from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import {
  checkInText,
  formatDayHeading,
  formatWindow,
  propertyName,
  taskPlace,
  urgencyText,
  windowLines,
} from './format';
import { calendarDay, isRunning, type CleaningTask } from './schema';

interface TaskCardProps {
  task: CleaningTask;
  /** Omitted in the "My cleanings" list, where there is nothing to claim. */
  onClaim?: (taskId: string) => void;
  /** Offered in her own list, on a cleaning she has not accepted yet; gets it as shown. */
  onAccept?: (task: CleaningTask) => void;
  /** Opens the task. Omitted where the row is not a link. */
  onPress?: (taskId: string) => void;
  isClaiming?: boolean;
  isAccepting?: boolean;
  /** Somebody said something about this job that she has not read yet. */
  hasUnread?: boolean;
  /** In the section of work under way: the «▶ Сейчас» pill and the stripe. */
  isNow?: boolean;
}

/**
 * Wide enough at the normal font for "10:00" in the title size and "В 15:00"
 * on one line; a check-in in a longer language takes a second line rather than
 * the place's room. Grows with the system font (`WindowColumn`).
 */
const WINDOW_COLUMN_WIDTH = 64;

/**
 * From this system font on, a column grown with the type would leave the place
 * too little room (at a doubled font about 70 dp on a small phone, the name cut
 * after two lines): the times stand above the place instead.
 */
const STACK_FONT_SCALE = 1.5;

/** The column of a stacked row: a line across the row, no width of its own. */
const STACKED_COLUMN = { alignSelf: 'stretch' } as const;

/** The ▶ before «Сейчас»: a triangle 8 dp high and about as wide. */
const PLAY_HALF_HEIGHT = Spacing.xs;
const PLAY_WIDTH = 7;

/** The states a row shows as marks; each is a word in its tone, never colour alone. */
interface RowMarks {
  isNow: boolean;
  /** A repair whose report the office marked high. */
  isUrgentFix: boolean;
  isRunning: boolean;
  isAccepted: boolean;
  hasUnread: boolean;
}

/** What a row says, worked out once: drawn on it, and read out as its label. */
interface RowText {
  /** The house, or on a fix what is broken. */
  name: string;
  /** The room after its house, on a cleaning of a multi-unit listing. */
  room: string | null;
  /** The place in one line, for the reader: a room is never said without its house. */
  spoken: string;
  /** What the banner of the old card said, for the label. */
  urgency: string;
  /** The check-in, drawn under the window. */
  checkIn: string | null;
  /** The quiet line: anything the banner said that is not the check-in. */
  quiet: string | null;
  /** The day and the window, for the reader: the day is the section's heading, not on the row. */
  when: string;
}

function rowText(task: CleaningTask, t: TFunction): RowText {
  const fix = task.type === 'maintenance' ? (task.problem ?? null) : null;
  const place = taskPlace(task);
  const checkIn = checkInText(task);
  // The banner of the old card: the check-in, what the job is, that nobody
  // arrives, or on a fix the flat and how urgent.
  const urgency =
    fix === null
      ? urgencyText(task)
      : t('tasks.detail.fixBanner', {
          property: propertyName(task),
          priority: t(`problems.priorities.${fix.priority}`),
        });

  return {
    name: fix === null ? place.building : fix.title,
    // A fix carries the whole place in its quiet line already.
    room: fix === null ? place.room : null,
    spoken: fix === null ? propertyName(task) : fix.title,
    urgency,
    checkIn,
    quiet: checkIn === null ? urgency : null,
    when: [formatDayHeading(task.scheduled_date), formatWindow(task)]
      .filter((part) => part !== null)
      .join(', '),
  };
}

/** The row as one sentence: what it says, its marks included. */
function rowLabel(text: RowText, marks: RowMarks, t: TFunction): string {
  return [
    marks.isNow ? t('tasks.now') : null,
    t('tasks.cardAccessibility', { property: text.spoken, date: text.when, urgency: text.urgency }),
    marks.isRunning ? t('tasks.status.inProgress') : null,
    marks.isAccepted ? t('tasks.status.accepted') : null,
    marks.hasUnread ? t('chat.unread') : null,
  ]
    .filter((part) => part !== null)
    .join('. ');
}

/**
 * A cleaning as one row of a list (5.4, «Списки уборок», variant 1): the
 * window large on the left with the check-in under it — the two times she
 * plans by, together — the place and one quiet line in the middle, and «Взять»
 * or «Принять» as a 56 dp button of its own on the right. The day is the
 * heading of the row's section, not a line of the row.
 */
function TaskCardComponent({
  task,
  onClaim,
  onAccept,
  onPress,
  isClaiming = false,
  isAccepting = false,
  hasUnread = false,
  isNow = false,
}: TaskCardProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { fontScale } = useWindowDimensions();
  const isStacked = fontScale >= STACK_FONT_SCALE;
  const text = rowText(task, t);
  // «В работе» is a section without a day: a cleaning planned for another day
  // and still running says its day, or it would pass for today's.
  const day =
    isNow && task.scheduled_date !== calendarDay(new Date())
      ? formatDayHeading(task.scheduled_date)
      : null;
  const bodyStyle = [styles.body, isStacked && styles.bodyStacked, isNow && styles.bodyNow];
  const marks: RowMarks = {
    isNow,
    isUrgentFix: task.type === 'maintenance' && task.problem?.priority === 'high',
    isRunning: isRunning(task),
    // Hers already: the list only ever holds her own work, so the status says it.
    isAccepted: task.status === 'accepted',
    hasUnread,
  };
  const label = rowLabel(text, marks, t);

  const summary = (
    <>
      <WindowColumn task={task} checkIn={text.checkIn} day={day} fontScale={fontScale} />
      <View style={[styles.what, isStacked && styles.whatStacked]}>
        {/* Two lines: a room can be called "Unit 8 - 3rd floor", and the system
            font can be set large. */}
        <Text weight={700} numberOfLines={2}>
          {text.name}
          {text.room === null ? null : <Text tone="secondary">{` · ${text.room}`}</Text>}
        </Text>
        {text.quiet === null ? null : (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {text.quiet}
          </Text>
        )}
        <MarkRow marks={marks} />
      </View>
    </>
  );

  // The facts are read as one element, and opened as one where the row is a
  // link. "Take" sits beside them, never inside: VoiceOver reads a grouped
  // element whole, and a button inside one is out of its reach.
  const facts =
    onPress === undefined ? (
      <View style={bodyStyle} accessible accessibilityLabel={label}>
        {summary}
      </View>
    ) : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => onPress(task.id)}
        style={({ pressed }) => [...bodyStyle, pressed && styles.pressed]}
      >
        {summary}
      </Pressable>
    );

  return (
    <View testID="task-card" style={[styles.card, isNow && styles.cardNow]}>
      {facts}
      <RowAction
        task={task}
        text={text}
        onClaim={onClaim}
        // Only what she has not accepted yet; the queue never passes it.
        onAccept={task.status === 'assigned' ? onAccept : undefined}
        isClaiming={isClaiming}
        isAccepting={isAccepting}
      />
    </View>
  );
}

export const TaskCard = memo(TaskCardComponent);

interface WindowColumnProps {
  task: CleaningTask;
  checkIn: string | null;
  /** The day, on work under way planned for another day; null otherwise. */
  day: string | null;
  /** The system font's scale: the column grows with it, then gives way. */
  fontScale: number;
}

/**
 * The two times she plans by, together: the window large, the check-in under
 * it. The column is as wide as the type is large — at a large system font a
 * fixed width would cut "10:00" in two — and the same on every row, so the
 * places line up. From `STACK_FONT_SCALE` on it has no width of its own: the
 * row stacks, and the column is a line above the place.
 */
function WindowColumn({ task, checkIn, day, fontScale }: WindowColumnProps) {
  const theme = useTheme();
  const width = useMemo(
    () =>
      fontScale >= STACK_FONT_SCALE
        ? STACKED_COLUMN
        : { width: WINDOW_COLUMN_WIDTH * Math.max(1, fontScale) },
    [fontScale],
  );
  const window = windowLines(task);

  return (
    <View testID="task-window" style={width}>
      {window === null ? null : (
        <>
          {/* One edge alone is a time and a dash, too long for the title size:
              it takes the end's size. */}
          <Text variant={window.second === null ? 'caption' : 'title'}>{window.first}</Text>
          {window.second === null ? null : (
            <Text variant="caption" tone="secondary">
              {window.second}
            </Text>
          )}
        </>
      )}
      {day === null ? null : (
        <Text variant="caption" tone="secondary">
          {day}
        </Text>
      )}
      {checkIn === null ? null : (
        <Text variant="caption" color={statusTone(theme, 'phone.checkIn.sameDay').fg}>
          {checkIn}
        </Text>
      )}
    </View>
  );
}

interface MarkRowProps {
  marks: RowMarks;
}

/** The marks of a row as compact badges, or nothing when it has none. */
function MarkRow({ marks }: MarkRowProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const badges = [
    marks.isNow ? <NowPill key="now" label={t('tasks.now')} /> : null,
    // «Срочно», as on the task screen (docs/redesign-plan.md 2.4). The reader
    // hears the urgency once, in the row's quiet line («срочность: Высокая»).
    marks.isUrgentFix ? (
      <Badge
        key="urgent"
        testID="task-urgent"
        label={t('supplies.priorities.urgent')}
        tone={problemPriorityTone('high')}
      />
    ) : null,
    marks.isRunning ? (
      <Badge
        key="running"
        label={t('tasks.status.inProgress')}
        tone={taskStatusTone('in_progress')}
      />
    ) : null,
    marks.isAccepted ? (
      <Badge key="accepted" label={t('tasks.status.accepted')} tone={taskStatusTone('accepted')} />
    ) : null,
    marks.hasUnread ? (
      <Badge key="unread" label={t('chat.unread')} tone={STATUS_TONE['chat.unread']} />
    ) : null,
  ].filter((badge): badge is ReactElement => badge !== null);

  return badges.length === 0 ? null : <View style={styles.marks}>{badges}</View>;
}

interface RowActionProps {
  task: CleaningTask;
  text: RowText;
  onClaim?: (taskId: string) => void;
  onAccept?: (task: CleaningTask) => void;
  isClaiming: boolean;
  isAccepting: boolean;
}

/**
 * «Взять» or «Принять»: a 56 dp button beside the row, never inside it, named
 * by the cleaning it acts on. No list offers both — the queue claims and her
 * own list accepts.
 */
function RowAction({ task, text, onClaim, onAccept, isClaiming, isAccepting }: RowActionProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const named = { property: text.spoken, date: text.when };

  if (onClaim !== undefined) {
    return (
      <Button
        label={t('tasks.claim')}
        accessibilityLabel={t('tasks.claimAccessibility', named)}
        isBusy={isClaiming}
        onPress={() => onClaim(task.id)}
        style={styles.action}
      />
    );
  }
  if (onAccept !== undefined) {
    // Quieter than "take": accepting is a signal to the office, not the job.
    return (
      <Button
        variant="secondary"
        label={t('tasks.accept')}
        accessibilityLabel={t('tasks.acceptAccessibility', named)}
        isBusy={isAccepting}
        onPress={() => onAccept(task)}
        style={styles.action}
      />
    );
  }
  return null;
}

interface NowPillProps {
  label: string;
}

/** «▶ Сейчас»: the accent pill of the current card (directions.json, shape.nowCard). */
function NowPill({ label }: NowPillProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.now}>
      {/* Drawn rather than typed: a ▶ character turns into an emoji on some
          phones, and the icons arrive only with build 1.2.0. */}
      <View style={styles.play} />
      <Text variant="chip" color={theme.onAccent}>
        {label}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    // A card of direction A: no frame, a soft shadow (components/card.tsx).
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: theme.card,
      borderRadius: Radius.card,
      boxShadow: theme.shadow,
    },
    // The stripe of the current card follows its rounded corner as a border;
    // a bar laid over the card would stick out of the corner.
    cardNow: {
      borderLeftWidth: SIZE.nowStripe,
      borderLeftColor: theme.primary,
    },
    body: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      minHeight: ROW_HEIGHT,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.card,
    },
    // The stripe takes its width from the padding, so the times of the
    // current cards line up with the rest.
    bodyNow: { paddingLeft: Spacing.md - SIZE.nowStripe },
    // At the largest fonts: the times on a line above the place.
    bodyStacked: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.xs },
    pressed: { backgroundColor: theme.surfaceAlt },
    what: { flex: 1, gap: Spacing.xs },
    // In a column the place sizes to its lines, rather than share a height.
    whatStacked: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' },
    marks: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    // A square for a gloved finger, wider only as far as the word needs; the
    // gap of the card keeps it apart from the row it does not open.
    action: {
      minWidth: BUTTON_HEIGHT,
      paddingHorizontal: Spacing.md,
      marginRight: Spacing.md,
    },
    now: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      backgroundColor: theme.accent,
    },
    play: {
      width: 0,
      height: 0,
      borderLeftWidth: PLAY_WIDTH,
      borderTopWidth: PLAY_HALF_HEIGHT,
      borderBottomWidth: PLAY_HALF_HEIGHT,
      borderLeftColor: theme.onAccent,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
    },
  });
