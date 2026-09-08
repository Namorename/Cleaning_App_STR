import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { problemPlace } from '@/features/problems/format';
import { ProblemForm } from '@/features/problems/problem-form';
import { canEditProblem, draftOfProblem, type ProblemDraft } from '@/features/problems/schema';
import { useProblem, useUpdateProblem } from '@/features/problems/use-problems';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid() });

/** Correcting an open report. Photos are changed on the report's own screen. */
export default function EditProblemRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const parsed = Params.safeParse(useLocalSearchParams());
  const problemId = parsed.success ? parsed.data.id : '';

  const problem = useProblem(problemId);
  const update = useUpdateProblem();
  const [draft, setDraft] = useState<ProblemDraft | null>(null);

  // The draft starts from the row once, then belongs to her fingers.
  useEffect(() => {
    if (draft === null && problem.data) {
      setDraft(draftOfProblem(problem.data));
    }
  }, [draft, problem.data]);

  const isLeaving = update.isSuccess || update.isPaused;
  useEffect(() => {
    if (isLeaving) {
      router.back();
    }
  }, [isLeaving]);

  if (!problem.data || draft === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('problems.loading')}</Text>
      </View>
    );
  }

  if (!canEditProblem(problem.data, userId)) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{t('problems.notEditable')}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('problems.edit') }} />
      <ProblemForm
        draft={draft}
        onChange={setDraft}
        place={problemPlace(problem.data)}
        isSubmitting={update.isPending && !update.isPaused}
        submitLabel={t('problems.save')}
        onSubmit={() =>
          update.mutate({
            problemId,
            title: draft.title.trim(),
            description: draft.description.trim(),
            priority: draft.priority,
          })
        }
        error={update.error}
      />
    </>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.sm,
      backgroundColor: theme.background,
    },
    message: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
  });
