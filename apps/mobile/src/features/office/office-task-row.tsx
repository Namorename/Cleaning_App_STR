import { taskStatusTone, type Tone } from '@str-ops/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Text } from '@/components/text';
import { ROW_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
import {
  formatDayHeading,
  formatWindow,
  propertyName,
  taskPlace,
  urgencyText,
  windowLines,
} from '@/features/tasks/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { assigneeText, offLines, officeStatusText } from './format';
import type { OfficeTask } from './schema';

/** A cleaning handed back is said in the tone of what needs somebody now. */
const RELEASED_TONE: Tone = 'urgent';

/** Wide enough for "10:00" in the title size; the place takes the rest. */
const WINDOW_COLUMN_WIDTH = 64;

interface OfficeTaskRowProps {
  task: OfficeTask;
  onPress: (taskId: string) => void;
}

/**
 * A cleaning as one row of the office's «Уборки»: the window on the left, the
 * place and what the job is in the middle, and under them its status, who is
 * on it — or, handed back, who gave it back. The day is the section's heading.
 * Read as one sentence, opened as one button.
 */
export const OfficeTaskRow = memo(function OfficeTaskRow({ task, onPress }: OfficeTaskRowProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const place = taskPlace(task);
  const window = windowLines(task);
  const status = officeStatusText(task.status, t);
  // «Без исполнителя» is the status already; a name is said beside it.
  const who = task.assignee_id === null ? null : assigneeText(task, t);
  const released = task.status === 'unassigned' ? (offLines(task, t)[0] ?? null) : null;
  const label = [
    t('office.cleanings.row', {
      place: propertyName(task),
      when: [formatDayHeading(task.scheduled_date), formatWindow(task)]
        .filter((part) => part !== null)
        .join(', '),
      who: who ?? t('office.cleanings.nobody'),
      status,
    }),
    released,
  ]
    .filter((part) => part !== null)
    .join('. ');

  return (
    <Pressable
      testID="office-task-row"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPress(task.id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.window}>
        {window === null ? null : (
          <>
            <Text variant={window.second === null ? 'caption' : 'title'}>{window.first}</Text>
            {window.second === null ? null : (
              <Text variant="caption" tone="secondary">
                {window.second}
              </Text>
            )}
          </>
        )}
      </View>
      <View style={styles.what}>
        <Text weight={700} numberOfLines={2}>
          {place.building}
          {place.room === null ? null : <Text tone="secondary">{` · ${place.room}`}</Text>}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {urgencyText(task)}
        </Text>
        <View style={styles.marks}>
          <Badge label={status} tone={taskStatusTone(task.status)} />
          {who === null ? null : (
            <Text variant="caption" numberOfLines={1} style={styles.who}>
              {who}
            </Text>
          )}
          {released === null ? null : <Badge label={released} tone={RELEASED_TONE} />}
        </View>
      </View>
    </Pressable>
  );
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    // A card of direction A, as the cleaner's rows: no frame, a soft shadow.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      minHeight: ROW_HEIGHT,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      backgroundColor: theme.card,
      borderRadius: Radius.card,
      boxShadow: theme.shadow,
    },
    pressed: { backgroundColor: theme.surfaceAlt },
    window: { minWidth: WINDOW_COLUMN_WIDTH },
    what: { flex: 1, gap: Spacing.xs },
    marks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs },
    who: { flexShrink: 1 },
  });
