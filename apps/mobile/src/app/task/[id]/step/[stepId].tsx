import type { Json } from '@str-ops/shared';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { stepTitle } from '@/features/steps/format';
import { StepScreen } from '@/features/steps/step-screen';
import {
  useCompleteStep,
  useOpenStep,
  useReopenStep,
  useSkipStep,
  useTaskSteps,
} from '@/features/steps/use-steps';
import { useTask } from '@/features/tasks/use-tasks';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid(), stepId: z.string().uuid() });

/**
 * One step of a task.
 *
 * Wires the hooks and decides what happens after a tap: completing or
 * skipping a step takes her back to the task — at once when the server has
 * answered, and equally when the action is queued for lack of signal, because
 * the tick is already on the screen behind her. Reopening keeps her here.
 */
export default function StepRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const parsed = Params.safeParse(useLocalSearchParams());
  const taskId = parsed.success ? parsed.data.id : '';
  const stepId = parsed.success ? parsed.data.stepId : '';

  const task = useTask(taskId);
  const steps = useTaskSteps(taskId);
  const open = useOpenStep();
  const complete = useCompleteStep();
  const reopen = useReopenStep();
  const skip = useSkipStep();

  const step = steps.data?.find((item) => item.id === stepId);
  const isEditable =
    task.data?.status === 'in_progress' && task.data.assignee_id === userId && userId !== null;

  // The first opening is stamped once per visit, and only when there is
  // nothing stamped yet — the server keeps the first one anyway.
  const hasOpened = useRef(false);
  useEffect(() => {
    if (step !== undefined && isEditable && step.started_at === null && !hasOpened.current) {
      hasOpened.current = true;
      open.mutate({ taskId, stepId });
    }
  }, [step, isEditable, open, taskId, stepId]);

  const isLeaving = complete.isSuccess || complete.isPaused || skip.isSuccess || skip.isPaused;
  useEffect(() => {
    if (isLeaving) {
      router.back();
    }
  }, [isLeaving]);

  if (!parsed.success || userId === null) {
    return <Message text={t('steps.notFound')} styles={styles} />;
  }

  if (steps.isPending || task.isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('tasks.loading')}</Text>
      </View>
    );
  }

  if (steps.error) {
    return <Message text={steps.error.message} styles={styles} />;
  }

  if (step === undefined) {
    return <Message text={t('steps.notFound')} styles={styles} />;
  }

  const onComplete = (payload: Json) => {
    complete.mutate({
      taskId,
      stepId,
      payload,
      deviceCompletedAt: new Date().toISOString(),
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: stepTitle(step) }} />
      <StepScreen
        key={step.id}
        step={step}
        isEditable={isEditable === true}
        isBusy={complete.isPending || reopen.isPending || skip.isPending}
        error={complete.error ?? reopen.error ?? skip.error}
        onComplete={onComplete}
        onReopen={() => reopen.mutate({ taskId, stepId })}
        onSkip={() => skip.mutate({ taskId, stepId })}
      />
    </>
  );
}

interface MessageProps {
  text: string;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, styles }: MessageProps) {
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>{text}</Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
      backgroundColor: theme.background,
    },
    message: { fontSize: FontSize.body, color: theme.textSecondary, textAlign: 'center' },
  });
