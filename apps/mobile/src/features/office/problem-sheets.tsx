import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { ROW_HEIGHT, Spacing, type Theme } from '@/constants/theme';
import { personName } from '@/features/board/format';
import { isStaffTechnician, type StaffMember } from '@/features/board/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import type { ClosingAddition } from './problem-api';

/** The longest reason the sheet takes; the panel's field has no more room in practice. */
const MAX_REASON_LENGTH = 500;

/** Somebody who may have done the work, as the sheet names her. */
export interface WhoDidIt {
  id: string;
  name: string;
  isActive: boolean;
  isHolder: boolean;
}

/**
 * The people to choose from, as the panel's «Кто выполнил» lists them: the one
 * holding the repair first (even of another role), then the technicians at
 * work, then those switched off — a person who left can still be named.
 */
export function whoDidItChoices(
  staff: readonly StaffMember[],
  holderId: string | null,
  names: ReadonlyMap<string, string>,
): WhoDidIt[] {
  const named = (person: Pick<StaffMember, 'id' | 'is_active'>): WhoDidIt => ({
    id: person.id,
    name: personName(names, person.id),
    isActive: person.is_active,
    isHolder: person.id === holderId,
  });
  const workers = staff.filter(isStaffTechnician).map(named);
  const holder =
    holderId === null
      ? []
      : [
          workers.find((person) => person.id === holderId) ??
            named({ id: holderId, is_active: true }),
        ];
  const rest = workers.filter((person) => person.id !== holderId);
  return [
    ...holder,
    ...rest.filter((person) => person.isActive),
    ...rest.filter((person) => !person.isActive),
  ];
}

/** The longest comment: a message of the task's chat (chat_body_max_length). */
const MAX_COMMENT_LENGTH = 4000;

interface ResolveSheetProps {
  title: string;
  people: readonly WhoDidIt[];
  isBusy: boolean;
  error: Error | null;
  /**
   * Who did the work (null: nobody, the manager did it alone), and the comment with the ids the
   * sheet made for it (null: none — the closing of before).
   */
  onConfirm: (completedBy: string | null, closing: ClosingAddition | null) => void;
  /** «Фото и видео…»: the closing goes on in the screen of the files, with what is chosen here. */
  onAddFiles?: (completedBy: string | null, comment: string) => void;
  onClose: () => void;
}

/**
 * «Отметить выполненным?» with «Кто выполнил» (owner, 09.11): «Никто, менеджер
 * сам» unless somebody is named. Since 26.11 a comment, optional, and «Фото и
 * видео…», which carries the closing on to the screen of the files (a camera
 * and a gallery do not open over a sheet). A refusal stays on the sheet.
 */
export function ResolveSheet({
  title,
  people,
  isBusy,
  error,
  onConfirm,
  onAddFiles,
  onClose,
}: ResolveSheetProps) {
  const { t } = useTranslation();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  // Made once with the sheet: a press repeated after a lost answer replays the same message.
  const [ids] = useState(() => ({ additionId: randomUUID(), commentId: randomUUID() }));
  const active = people.filter((person) => person.isActive);
  const switchedOff = people.filter((person) => !person.isActive);
  const close = isBusy ? noop : onClose;
  const words = comment.trim();

  return (
    <BottomSheet
      testID="resolve-sheet"
      isVisible
      title={t('office.problem.resolveTitle')}
      onClose={close}
    >
      <ScrollView contentContainerStyle={layout.body}>
        <Text tone="secondary">{t('office.problem.resolveText', { title })}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('office.problem.who')}>
          <ChoiceRow
            label={t('office.problem.alone')}
            isChosen={chosenId === null}
            onPress={() => setChosenId(null)}
          />
          {active.map((person) => (
            <ChoiceRow
              key={person.id}
              label={person.isHolder ? `${person.name} · ${t('office.problem.holder')}` : person.name}
              isChosen={chosenId === person.id}
              onPress={() => setChosenId(person.id)}
            />
          ))}
          {switchedOff.length === 0 ? null : (
            <Text variant="caption" tone="secondary" weight={700} style={layout.group}>
              {t('office.problem.switchedOff')}
            </Text>
          )}
          {switchedOff.map((person) => (
            <ChoiceRow
              key={person.id}
              label={person.name}
              isChosen={chosenId === person.id}
              onPress={() => setChosenId(person.id)}
            />
          ))}
        </View>
        {chosenId === null ? null : <Text tone="secondary">{t('office.problem.hint')}</Text>}
        <TextField
          label={t('problems.additions.comment')}
          isDisabled={isBusy}
          maxLength={MAX_COMMENT_LENGTH}
          multiline
          onChangeText={setComment}
          value={comment}
        />
        <Text variant="caption" tone="secondary">
          {t('problems.additions.commentHint')}
        </Text>
      </ScrollView>
      {error !== null ? <FailureText error={error} /> : null}
      <Button
        label={t('office.problem.resolveConfirm')}
        isBusy={isBusy}
        onPress={() =>
          onConfirm(
            chosenId,
            words === '' ? null : { additionId: ids.additionId, comment: words, commentId: ids.commentId },
          )
        }
      />
      {onAddFiles === undefined ? null : (
        <Button
          variant="outline"
          label={t('problems.additions.add')}
          isDisabled={isBusy}
          onPress={() => onAddFiles(chosenId, comment)}
        />
      )}
      <Button variant="outline" label={t('office.problem.keep')} isDisabled={isBusy} onPress={close} />
    </BottomSheet>
  );
}

interface CancelProblemSheetProps {
  isBusy: boolean;
  error: Error | null;
  /** The words as typed, trimmed; null when none. */
  onConfirm: (reason: string | null) => void;
  onClose: () => void;
}

/** «Отменить задание»: its live repair goes with it; the reason may stay unsaid. */
export function CancelProblemSheet({ isBusy, error, onConfirm, onClose }: CancelProblemSheetProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const close = isBusy ? noop : onClose;
  const trimmed = reason.trim();

  return (
    <BottomSheet
      testID="cancel-problem-sheet"
      isVisible
      title={t('office.problem.cancel')}
      onClose={close}
    >
      <ScrollView contentContainerStyle={layout.body} keyboardShouldPersistTaps="handled">
        <TextField
          label={t('office.problem.cancelReason')}
          isDisabled={isBusy}
          maxLength={MAX_REASON_LENGTH}
          multiline
          onChangeText={setReason}
          value={reason}
        />
      </ScrollView>
      {error !== null ? <FailureText error={error} /> : null}
      <Button
        variant="destructive"
        label={t('office.problem.cancelConfirm')}
        isBusy={isBusy}
        onPress={() => onConfirm(trimmed === '' ? null : trimmed)}
      />
      <Button
        variant="outline"
        label={t('office.problem.cancelAbort')}
        isDisabled={isBusy}
        onPress={close}
      />
    </BottomSheet>
  );
}

function noop(): void {}

interface ChoiceRowProps {
  label: string;
  isChosen: boolean;
  onPress: () => void;
}

/** One choice: a 64 dp row, a radio to the reader, ✓ when chosen. */
function ChoiceRow({ label, isChosen, onPress }: ChoiceRowProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: isChosen, selected: isChosen }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text weight={isChosen ? 800 : undefined} style={layout.label}>
        {label}
      </Text>
      {isChosen ? <Icon name="status.done" tone="primary" /> : null}
    </Pressable>
  );
}

const layout = StyleSheet.create({
  body: { gap: Spacing.sm },
  group: { paddingTop: Spacing.sm },
  label: { flex: 1 },
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
