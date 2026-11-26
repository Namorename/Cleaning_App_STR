import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { personName, staffNames } from '@/features/board/format';
import { useStaffDirectory } from '@/features/board/use-board';
import { mediaOfStep } from '@/features/media/schema';
import { useTaskMedia } from '@/features/media/use-media';
import { stepStateText, stepTitle } from '@/features/steps/format';
import { stepState } from '@/features/steps/schema';
import { useTaskSteps } from '@/features/steps/use-steps';

import { MediaTiles } from './media-tiles';

/** A fix attempt as the task's row carries it (`fix_tasks`). */
export interface FixAttempt {
  id: string;
  assignee_id: string | null;
  status: string;
}

/** The statuses of an attempt that is over. */
const OVER: readonly string[] = ['done', 'cancelled', 'expired'];

/** The live attempt first, then those that are over, each group as the row lists them. */
export function attemptsInOrder(fixTasks: readonly FixAttempt[]): FixAttempt[] {
  return [
    ...fixTasks.filter((task) => !OVER.includes(task.status)),
    ...fixTasks.filter((task) => OVER.includes(task.status)),
  ];
}

interface FixWorkProps {
  fixTasks: readonly FixAttempt[];
}

/**
 * «Работа техника» on a task's screen for the office and the head technician (2026-11-26): each
 * attempt's steps, in order, with the photos and videos the technician took on them, opened in
 * the viewer — what his own screen shows him, read-only. Until then the phone showed them to the
 * technician alone, and a manager saw none. An attempt that never started has no steps and draws
 * nothing.
 */
export function FixWork({ fixTasks }: FixWorkProps) {
  const ordered = useMemo(() => attemptsInOrder(fixTasks), [fixTasks]);
  return (
    <>
      {ordered.map((attempt) => (
        <AttemptWork key={attempt.id} attempt={attempt} />
      ))}
    </>
  );
}

interface AttemptWorkProps {
  attempt: FixAttempt;
}

/** One attempt: who and how it stands, then its steps with their files. */
function AttemptWork({ attempt }: AttemptWorkProps) {
  const { t } = useTranslation();
  const steps = useTaskSteps(attempt.id);
  const media = useTaskMedia(attempt.id);
  const staff = useStaffDirectory();
  const names = useMemo(() => staffNames(staff.data, t), [staff.data, t]);
  // Evidence only: a row without `uploaded_at` is a file still on its way from his phone.
  const uploaded = useMemo(
    () => (media.data ?? []).filter((item) => item.uploaded_at !== null),
    [media.data],
  );
  const list = steps.data ?? [];

  if (list.length === 0 && steps.error === null) {
    return null;
  }

  return (
    <View style={layout.block} testID="fix-work">
      <Text variant="caption" weight={700} tone="secondary">
        {t('problems.fixWork.title')}
      </Text>
      <Text variant="caption" tone="secondary">
        {t('problems.fixWork.by', {
          name: personName(names, attempt.assignee_id),
          status: t(`office.statuses.${attempt.status}`),
        })}
      </Text>
      {steps.error !== null || media.error !== null ? (
        <ErrorBanner title={t('common.refreshFailedSaved')} error={steps.error ?? media.error} />
      ) : null}
      {list.map((step, index) => (
        <View key={step.id} style={layout.step}>
          <Text>{`${index + 1}. ${stepTitle(step)}`}</Text>
          <Text variant="caption" tone="secondary">
            {stepStateText(stepState(step))}
          </Text>
          <MediaTiles files={mediaOfStep(uploaded, step.id)} />
        </View>
      ))}
    </View>
  );
}

const layout = StyleSheet.create({
  block: { gap: Spacing.sm },
  step: { gap: Spacing.xs },
});
