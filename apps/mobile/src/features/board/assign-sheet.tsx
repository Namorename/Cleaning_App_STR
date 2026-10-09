import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { ChoiceChips } from '@/components/choice-chips';
import { FailureText } from '@/components/failure-text';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { ROW_HEIGHT, Spacing, type Theme } from '@/constants/theme';
import { formatDayHeading } from '@/features/tasks/format';
import { calendarDay } from '@/features/tasks/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { personName } from './format';
import type { StaffMember } from './schema';

/**
 * Today and the seven days after it: the technician's horizon. A repair
 * handed out further ahead is out of his sight — no job, no task, no push —
 * until it comes within it (docs/tech-plan.md §5, the +7 days horizon).
 */
const DAYS_AHEAD = 7;

function weekAhead(now: Date): { value: string; label: string }[] {
  return Array.from({ length: DAYS_AHEAD + 1 }, (_, offset) => {
    const value = calendarDay(now, offset);
    return { value, label: formatDayHeading(value, now) };
  });
}

interface AssignSheetProps {
  /** The active technicians, himself among them; undefined while the directory loads. */
  technicians: readonly StaffMember[] | undefined;
  /** The whole directory's names (`staffNames`): a nameless technician keeps his number. */
  names: ReadonlyMap<string, string>;
  staffError: Error | null;
  /** Reads the directory again after it failed. */
  onRetryStaff: () => void;
  /** The head technician himself, marked «Это вы» in the list. */
  meId: string | null;
  isBusy: boolean;
  /** The last attempt's refusal, said above the button. */
  error: Error | null;
  onAssign: (assigneeId: string, scheduledDate: string) => void;
  onClose: () => void;
}

/**
 * «Назначить»: a day — today unless he says otherwise — and a technician
 * (decisions 1 and 8). Nothing is sent until a person is chosen; a refusal
 * stays on the sheet with the choices, so he can choose again.
 */
export function AssignSheet({
  technicians,
  names,
  staffError,
  onRetryStaff,
  meId,
  isBusy,
  error,
  onAssign,
  onClose,
}: AssignSheetProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const days = useMemo(() => weekAhead(new Date()), []);
  const [day, setDay] = useState(days[0].value);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);

  return (
    <BottomSheet
      testID="assign-sheet"
      isVisible
      title={t('problems.dispatch.assignTitle')}
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <Label text={t('problems.dispatch.day')} />
        <ChoiceChips
          semantics="radio"
          options={days}
          value={day}
          onChange={setDay}
          accessibilityLabel={t('problems.dispatch.day')}
        />
        <Label text={t('problems.dispatch.technician')} />
        <View accessibilityRole="radiogroup" accessibilityLabel={t('problems.dispatch.technician')}>
          {technicians === undefined && staffError === null ? (
            <Text tone="secondary">{t('problems.dispatch.loadingStaff')}</Text>
          ) : null}
          {technicians?.length === 0 ? (
            <Text tone="secondary">{t('problems.dispatch.noTechnicians')}</Text>
          ) : null}
          {(technicians ?? []).map((person) => (
            <TechnicianRow
              key={person.id}
              name={personName(names, person.id)}
              note={person.id === meId ? t('problems.dispatch.you') : null}
              isChosen={person.id === assigneeId}
              onPress={() => setAssigneeId(person.id)}
            />
          ))}
        </View>
        {staffError !== null ? (
          <>
            <FailureText error={staffError} />
            <Button variant="outline" label={t('common.retry')} onPress={onRetryStaff} />
          </>
        ) : null}
      </ScrollView>
      {error !== null ? <FailureText error={error} /> : null}
      <Button
        label={t('problems.dispatch.assign')}
        isDisabled={assigneeId === null}
        isBusy={isBusy}
        onPress={() => {
          if (assigneeId !== null) {
            onAssign(assigneeId, day);
          }
        }}
      />
    </BottomSheet>
  );
}

interface LabelProps {
  text: string;
}

function Label({ text }: LabelProps) {
  return (
    <Text variant="caption" tone="secondary" weight={700}>
      {text}
    </Text>
  );
}

interface TechnicianRowProps {
  name: string;
  /** «Это вы» on his own row. */
  note: string | null;
  isChosen: boolean;
  onPress: () => void;
}

/** One technician to choose: a 64 dp row, a radio to the reader, ✓ when chosen. */
function TechnicianRow({ name, note, isChosen, onPress }: TechnicianRowProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={note === null ? name : `${name}, ${note}`}
      accessibilityState={{ checked: isChosen, selected: isChosen }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.lines}>
        <Text weight={isChosen ? 800 : undefined}>{name}</Text>
        {note !== null ? (
          <Text variant="caption" tone="secondary">
            {note}
          </Text>
        ) : null}
      </View>
      {isChosen ? <Icon name="status.done" tone="primary" /> : null}
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    body: { gap: Spacing.sm },
    row: {
      minHeight: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    lines: { flex: 1, gap: 2 },
    pressed: { backgroundColor: theme.surfaceAlt },
  });
