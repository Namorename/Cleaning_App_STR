import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { ROW_HEIGHT, Spacing, type Theme } from '@/constants/theme';
import { personName } from '@/features/board/format';
import type { StaffMember } from '@/features/board/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';

interface CleanerSheetProps {
  /** The active cleaners; undefined while the directory loads. */
  cleaners: readonly StaffMember[] | undefined;
  /** The directory's names (`staffNames`). */
  names: ReadonlyMap<string, string>;
  /** Who is on the cleaning now, marked in the list; null for nobody. */
  currentId: string | null;
  staffError: Error | null;
  onRetryStaff: () => void;
  isBusy: boolean;
  /** The last attempt's refusal, said above the button. */
  error: Error | null;
  onAssign: (cleanerId: string) => void;
  onClose: () => void;
}

/**
 * «Назначить» on a cleaning: one of the cleaners at work. Nothing is sent
 * until somebody other than the one on it is chosen; a refusal stays on the
 * sheet with the choice, so another can be tried.
 */
export function CleanerSheet({
  cleaners,
  names,
  currentId,
  staffError,
  onRetryStaff,
  isBusy,
  error,
  onAssign,
  onClose,
}: CleanerSheetProps) {
  const { t } = useTranslation();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const isReady = chosenId !== null && chosenId !== currentId;

  return (
    <BottomSheet
      testID="cleaner-sheet"
      isVisible
      title={t('office.cleaning.assignTitle')}
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={layout.body}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('office.cleaning.cleaners')}>
          {cleaners === undefined && staffError === null ? (
            <Text tone="secondary">{t('office.cleaning.loadingCleaners')}</Text>
          ) : null}
          {cleaners?.length === 0 ? (
            <Text tone="secondary">{t('office.cleaning.noCleaners')}</Text>
          ) : null}
          {(cleaners ?? []).map((person) => (
            <CleanerRow
              key={person.id}
              name={personName(names, person.id)}
              note={person.id === currentId ? t('office.cleaning.current') : null}
              isChosen={person.id === chosenId}
              onPress={() => setChosenId(person.id)}
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
        label={t('office.cleaning.assign')}
        isDisabled={!isReady}
        isBusy={isBusy}
        onPress={() => {
          if (isReady && chosenId !== null) {
            onAssign(chosenId);
          }
        }}
      />
    </BottomSheet>
  );
}

interface CleanerRowProps {
  name: string;
  /** «сейчас на уборке» on the one who holds it. */
  note: string | null;
  isChosen: boolean;
  onPress: () => void;
}

/** One cleaner to choose: a 64 dp row, a radio to the reader, ✓ when chosen. */
function CleanerRow({ name, note, isChosen, onPress }: CleanerRowProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={note === null ? name : `${name}, ${note}`}
      accessibilityState={{ checked: isChosen, selected: isChosen }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={layout.lines}>
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

const layout = StyleSheet.create({
  body: { gap: Spacing.sm },
  lines: { flex: 1, gap: 2 },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    pressed: { backgroundColor: theme.surfaceAlt },
  });
