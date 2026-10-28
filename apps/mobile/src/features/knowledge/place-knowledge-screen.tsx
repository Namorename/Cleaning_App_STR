import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { currentLanguage } from '@/i18n';

import { ArticleList } from './article-list';
import { articlesOfPlace, isKnowledgeBaseMissing, placeLabel } from './schema';
import { useKbArticles, useKbPlace } from './use-knowledge';

interface PlaceKnowledgeScreenProps {
  propertyId: number;
}

/**
 * «Инструкции объекта»: the articles of one place — its own, its house's, its
 * rooms' — opened from a cleaning's or a report's card. There is no screen of
 * a place on the phone (docs/knowledge-base-plan.md §1.7), so this is one of
 * its own; the company's articles are a row away, under «База знаний».
 */
export function PlaceKnowledgeScreen({ propertyId }: PlaceKnowledgeScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const place = useKbPlace(propertyId);
  const articles = useKbArticles();
  // Both reads again: the place's house may have changed with its articles.
  const askAgain = () => {
    void articles.refetch();
    void place.refetch();
  };

  if (place.isPending || articles.isPending) {
    return <LoadingState label={t('knowledge.loading')} />;
  }

  const failure = articles.data === undefined ? articles.error : place.error;
  if (articles.data === undefined || place.data === undefined) {
    return (
      <View style={styles.screen}>
        {isKnowledgeBaseMissing(failure) ? (
          <EmptyState title={t('knowledge.placeEmpty')} />
        ) : (
          <ErrorState error={failure} title={t('knowledge.loadError')} onRetry={askAgain} />
        )}
      </View>
    );
  }

  // A place she may not read has no instructions for her.
  const shown =
    place.data === null ? [] : articlesOfPlace(articles.data, place.data, currentLanguage());

  return (
    <View style={styles.screen}>
      <ArticleList
        articles={shown}
        isRefreshing={articles.isRefetching || place.isRefetching}
        onRefresh={askAgain}
        header={
          <View style={layout.header}>
            {articles.error !== null ? (
              <ErrorBanner title={t('common.refreshFailed')} error={articles.error} />
            ) : null}
            {place.data === null ? null : (
              <Text variant="heading" accessibilityRole="header">
                {placeLabel(place.data)}
              </Text>
            )}
          </View>
        }
        footer={
          <ListRow
            title={t('knowledge.allArticles')}
            left={<Icon name="nav.knowledge" tone="primary" />}
            right={<Icon name="action.next" tone="secondary" />}
            onPress={() => router.push('/knowledge')}
          />
        }
        empty={<EmptyState title={t('knowledge.placeEmpty')} />}
      />
    </View>
  );
}

const layout = StyleSheet.create({
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, gap: Spacing.md },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
