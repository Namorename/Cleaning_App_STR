import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { MIN_TOUCH_TARGET, Spacing } from '@/constants/theme';
import { currentLanguage } from '@/i18n';

import { articlesOfPlace } from './schema';
import { useKbArticles, useKbPlace } from './use-knowledge';

interface PlaceInstructionsProps {
  /** The place of the cleaning or the report; a report may have none. */
  propertyId: number | null;
}

/**
 * «Инструкции объекта» in a cleaning's or a report's card: how many articles
 * the place has — its own, its house's, its rooms' — and the way to them.
 *
 * Nothing at all until there is something to show: while it loads, when the
 * place has none, and when the read fails — a cloud without the knowledge
 * base yet (the migration of step 1 comes before this update) or no signal.
 * The card around it stays exactly as it was (docs/knowledge-base-step2.md).
 */
export function PlaceInstructions({ propertyId }: PlaceInstructionsProps) {
  const { t } = useTranslation();
  const place = useKbPlace(propertyId);
  const articles = useKbArticles(propertyId !== null);

  if (propertyId === null || place.data === null || place.data === undefined) {
    return null;
  }
  if (articles.data === undefined) {
    return null;
  }
  const count = articlesOfPlace(articles.data, place.data, currentLanguage()).length;
  if (count === 0) {
    return null;
  }

  const label = t('knowledge.placeBlock');
  const countText = t('knowledge.articleCount', { count });

  return (
    <Card
      accessibilityLabel={`${label}, ${countText}`}
      accessibilityHint={t('knowledge.openPlaceHint')}
      onPress={() =>
        router.push({ pathname: '/knowledge/place/[id]', params: { id: String(propertyId) } })
      }
      style={layout.target}
    >
      <View style={layout.row}>
        <Icon name="nav.knowledge" tone="primary" />
        <View style={layout.text}>
          <Text variant="caption" tone="secondary" weight={700}>
            {label}
          </Text>
          <Text>{countText}</Text>
        </View>
        <Icon name="action.next" tone="secondary" />
      </View>
    </Card>
  );
}

const layout = StyleSheet.create({
  target: { minHeight: MIN_TOUCH_TARGET },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  text: { flex: 1, gap: Spacing.xs },
});
