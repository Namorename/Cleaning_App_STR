import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { EmptyState } from '@/components/empty-state';
import { type Theme } from '@/constants/theme';
import { SignedInRoute } from '@/features/auth/signed-in-route';
import { PlaceKnowledgeScreen } from '@/features/knowledge/place-knowledge-screen';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.coerce.number().int().positive() });

/** «Инструкции объекта», opened from a cleaning's or a report's card. */
export default function PlaceKnowledgeRoute() {
  const { t } = useTranslation();

  return (
    <SignedInRoute loadingText={t('common.loading')}>
      <PlaceKnowledge />
    </SignedInRoute>
  );
}

/** safeParse rather than parse: a malformed link must not crash the screen. */
function PlaceKnowledge() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const parsed = Params.safeParse(useLocalSearchParams());

  if (!parsed.success) {
    return (
      <View style={styles.screen}>
        <EmptyState title={t('knowledge.placeEmpty')} />
      </View>
    );
  }
  return <PlaceKnowledgeScreen propertyId={parsed.data.id} />;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
