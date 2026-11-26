import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { isLive } from '@/features/board/schema';
import { useBoardProblem } from '@/features/board/use-board';
import { DueGrid } from '@/features/problems/due-field';
import { formatCalendarDate } from '@/features/tasks/format';

import { useSetProblemDue } from './use-office';

interface OfficeProblemDueProps {
  problemId: string;
}

/**
 * The office's «Дата выполнения» on a task's screen (owner, 2026-11-26): «Выбрать дату» or
 * «Изменить дату» opens the month grid on a sheet, «Убрать дату» clears the day at once. Like the
 * office's other levers (problem-actions.tsx) it is sent at once or not at all, offered on what the
 * screen read from the server since it opened, and only on a live task out of the archive — a
 * closed one waits for no day. The day itself is a fact of the screen (problem-detail.tsx).
 */
export function OfficeProblemDue({ problemId }: OfficeProblemDueProps) {
  const { t } = useTranslation();
  const problem = useBoardProblem(problemId);
  const save = useSetProblemDue();
  const [isPicking, setPicking] = useState(false);

  const task = problem.data ?? null;
  if (task === null || !isLive(task)) {
    return null;
  }

  const isCurrent = problem.isFetchedAfterMount && problem.error === null;
  const isClearing = save.isPending && save.variables?.dueOn === null;

  const send = (dueOn: string | null) => {
    if (save.isPending) {
      return;
    }
    save.mutate({ problemId, dueOn }, { onSuccess: () => setPicking(false) });
  };

  const openSheet = () => {
    if (save.isPending) {
      return;
    }
    save.reset();
    setPicking(true);
  };

  return (
    <View style={layout.section}>
      {save.error !== null && !isPicking ? <FailureText error={save.error} /> : null}
      <Button
        variant="outline"
        label={task.due_on === null ? t('problems.due.pick') : t('problems.due.change')}
        isDisabled={!isCurrent || save.isPending}
        onPress={openSheet}
      />
      {task.due_on === null ? null : (
        <Button
          variant="outline"
          label={t('problems.due.clear')}
          isBusy={isClearing}
          isDisabled={!isCurrent || (save.isPending && !isClearing)}
          onPress={() => {
            save.reset();
            send(null);
          }}
        />
      )}
      {isPicking ? (
        <DueSheet
          initial={task.due_on}
          isBusy={save.isPending}
          error={save.error}
          onSave={send}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </View>
  );
}

interface DueSheetProps {
  /** The day the task has now; null for none. */
  initial: string | null;
  isBusy: boolean;
  error: Error | null;
  onSave: (day: string) => void;
  onClose: () => void;
}

/** The grid on a sheet: «Сохранить дату» sends the day picked, once it differs from the task's. */
function DueSheet({ initial, isBusy, error, onSave, onClose }: DueSheetProps) {
  const { t } = useTranslation();
  const [day, setDay] = useState<string | null>(initial);
  const close = isBusy ? noop : onClose;

  return (
    <BottomSheet
      testID="problem-due-sheet"
      isVisible
      title={t('problems.due.label')}
      onClose={close}
    >
      <ScrollView contentContainerStyle={layout.body}>
        <Text accessibilityLiveRegion="polite" testID="problem-due-picked">
          {day === null ? t('problems.due.none') : formatCalendarDate(day)}
        </Text>
        <Text variant="caption" tone="secondary">
          {t('problems.due.hint')}
        </Text>
        <DueGrid value={day} onPick={setDay} testID="problem-due-sheet-grid" />
      </ScrollView>
      {error !== null ? <FailureText error={error} /> : null}
      <Button
        label={t('problems.due.save')}
        isBusy={isBusy}
        isDisabled={day === null || day === initial}
        onPress={() => {
          if (day !== null) {
            onSave(day);
          }
        }}
      />
      <Button variant="outline" label={t('common.cancel')} isDisabled={isBusy} onPress={close} />
    </BottomSheet>
  );
}

function noop(): void {}

/** Sizes only: the colours are the components'. */
const layout = StyleSheet.create({
  section: { gap: Spacing.md },
  body: { gap: Spacing.sm },
});
