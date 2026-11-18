import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { isOffice } from '@/features/auth/role';
import { useRole } from '@/features/auth/use-role';
import { ProblemHistory } from '@/features/history/problem-history';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid() });

/**
 * A task's history — the head technician's (brief, item 3) and, since the
 * office runs the company from the phone too (owner, 2026-11-18), a manager's
 * or an admin's: both read the journal (RLS, 20261003140000). Anybody else
 * reads none, so the screen does not pretend there is one to show: the task
 * is not theirs to see. Thin: params in, the screen is ProblemHistory; the
 * header and its title are the root layout's (app/_layout.tsx).
 */
export default function ProblemHistoryRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const parsed = Params.safeParse(useLocalSearchParams());
  const role = useRole();
  const readsJournal = role === 'head_tech' || isOffice(role);

  if (!parsed.success || !readsJournal) {
    return (
      <View style={styles.message}>
        <Text tone="secondary" align="center">
          {t('problems.notFound')}
        </Text>
      </View>
    );
  }

  return <ProblemHistory problemId={parsed.data.id} />;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    message: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      backgroundColor: theme.background,
    },
  });
