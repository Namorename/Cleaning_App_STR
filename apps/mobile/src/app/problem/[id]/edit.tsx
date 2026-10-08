import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ErrorState } from '@/components/error-state';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { BUTTON_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
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

  // The draft starts from the row once, then belongs to her fingers. Set
  // while rendering rather than in an effect: React draws again at once with
  // the draft, before anything reaches the screen, and a later refetch finds
  // the draft taken and leaves her typing alone.
  if (draft === null && problem.data) {
    setDraft(draftOfProblem(problem.data));
  }

  const isLeaving = update.isSuccess || update.isPaused;
  useEffect(() => {
    if (isLeaving) {
      router.back();
    }
  }, [isLeaving]);

  // A report that never loaded says why, rather than loading for ever.
  if (problem.error && !problem.data) {
    return (
      <View style={styles.screen}>
        <ErrorState error={problem.error} />
      </View>
    );
  }

  if (problem.data === null) {
    return <Message text={t('problems.notFound')} styles={styles} />;
  }

  if (!problem.data || draft === null) {
    return <FormSkeleton label={t('problems.loading')} styles={styles} />;
  }

  if (!canEditProblem(problem.data, userId)) {
    return <Message text={t('problems.notEditable')} styles={styles} />;
  }

  // The header and its title are the root layout's (app/_layout.tsx).
  return (
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
  );
}

interface MessageProps {
  text: string;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, styles }: MessageProps) {
  return (
    <View style={[styles.screen, styles.centered]}>
      <Text tone="secondary" align="center">
        {text}
      </Text>
    </View>
  );
}

/** The form's blocks: a label, the title field, a label, the details box, the button. */
const SKELETON_LABEL = 16;
const SKELETON_BOX = 120;

interface FormSkeletonProps {
  label: string;
  styles: ReturnType<typeof createStyles>;
}

function FormSkeleton({ label, styles }: FormSkeletonProps) {
  return (
    <View style={styles.screen}>
      <SkeletonGroup label={label} style={layout.content}>
        <Skeleton height={SKELETON_LABEL} width="35%" />
        <Skeleton height={BUTTON_HEIGHT} radius={Radius.lg} />
        <Skeleton height={SKELETON_LABEL} width="35%" />
        <Skeleton height={SKELETON_BOX} radius={Radius.lg} />
        <Skeleton height={BUTTON_HEIGHT} radius={Radius.pill} />
      </SkeletonGroup>
    </View>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
    },
  });
