import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { hasBoards } from '@/features/auth/role';
import { useRole } from '@/features/auth/use-role';
import { CardScreen } from '@/features/manager-boards/card-screen';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid() });

/**
 * A manager board's card. Only a manager and an admin read boards (row level security);
 * anybody else — and a link that is not a card's id — reads «not found».
 */
export default function BoardCardRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const parsed = Params.safeParse(useLocalSearchParams());
  const role = useRole();

  if (!parsed.success || !hasBoards(role)) {
    return (
      <View style={styles.message}>
        <Text tone="secondary" align="center">
          {t('boards.cardGone')}
        </Text>
      </View>
    );
  }
  return <CardScreen cardId={parsed.data.id} />;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    message: {
      flex: 1,
      justifyContent: 'center',
      padding: Spacing.lg,
      backgroundColor: theme.background,
    },
  });
