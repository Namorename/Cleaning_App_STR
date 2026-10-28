import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { TextField } from '@/components/text-field';
import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { currentLanguage } from '@/i18n';

import { ArticleList } from './article-list';
import { isKnowledgeBaseMissing, searchArticles, sortArticles } from './schema';
import { useKbArticles } from './use-knowledge';

/**
 * «База знаний»: every article the reader may read — the company's rules, her
 * places' instructions — and a search over the titles and the text, run on
 * the phone over what is loaded (the owner's decision of 2026-10-17).
 */
export function KnowledgeScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const [query, setQuery] = useState('');
  const articles = useKbArticles();
  const language = currentLanguage();
  // Searched and sorted again only when the articles, the words or the language change.
  const shown = useMemo(
    () =>
      articles.data === undefined
        ? []
        : sortArticles(searchArticles(articles.data, query), language),
    [articles.data, query, language],
  );

  if (articles.isPending) {
    return <LoadingState label={t('knowledge.loading')} />;
  }
  if (articles.data === undefined) {
    return (
      <View style={styles.screen}>
        {isKnowledgeBaseMissing(articles.error) ? (
          // The cloud has no knowledge base yet: to the reader, an empty one.
          <EmptyState title={t('knowledge.empty')} message={t('knowledge.emptyHint')} />
        ) : (
          <ErrorState
            error={articles.error}
            title={t('knowledge.loadError')}
            onRetry={() => void articles.refetch()}
          />
        )}
      </View>
    );
  }

  const isBaseEmpty = articles.data.length === 0;

  return (
    <View style={styles.screen}>
      <ArticleList
        articles={shown}
        isRefreshing={articles.isRefetching}
        onRefresh={() => void articles.refetch()}
        header={
          <View style={layout.header}>
            {articles.error !== null ? (
              <ErrorBanner title={t('common.refreshFailed')} error={articles.error} />
            ) : null}
            {isBaseEmpty ? null : (
              <TextField
                label={t('knowledge.search')}
                hint={t('knowledge.searchHint')}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            )}
          </View>
        }
        empty={
          isBaseEmpty ? (
            <EmptyState title={t('knowledge.empty')} message={t('knowledge.emptyHint')} />
          ) : (
            <EmptyState title={t('knowledge.noMatches')} />
          )
        }
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
