import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useScreenEdgePadding } from '@/components/bottom-inset';
import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { currentLanguage } from '@/i18n';

import { KbBody } from './kb-body';
import { isKnowledgeBaseMissing, readArticleText } from './schema';
import { useKbArticles } from './use-knowledge';

interface ArticleScreenProps {
  articleId: string;
}

/**
 * One article: its title and text in the phone's language when it has a
 * translation, else in its author's — said under the title, so a reader
 * knows why (the owner's decision of 2026-10-17). Read from the one list of
 * the base: an article the rules no longer let her see is gone from it.
 */
export function ArticleScreen({ articleId }: ArticleScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const theme = useTheme();
  const end = useScreenEdgePadding(Spacing.lg);
  const articles = useKbArticles();

  if (articles.isPending) {
    return <LoadingState label={t('knowledge.loading')} />;
  }
  if (articles.data === undefined && !isKnowledgeBaseMissing(articles.error)) {
    return (
      <View style={styles.screen}>
        <ErrorState
          error={articles.error}
          title={t('knowledge.loadError')}
          onRetry={() => void articles.refetch()}
        />
      </View>
    );
  }

  const article = articles.data?.find((one) => one.id === articleId);
  if (article === undefined) {
    return (
      <View style={styles.screen}>
        <EmptyState title={t('knowledge.notFound')} />
      </View>
    );
  }

  const language = currentLanguage();
  const text = readArticleText(article, language);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[layout.content, end]}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        // The platform's spinner is a dark tick on iOS without a tint: invisible in the dark.
        <RefreshControl
          refreshing={articles.isRefetching}
          onRefresh={() => void articles.refetch()}
          tintColor={theme.textSecondary}
          colors={[theme.textSecondary]}
        />
      }
    >
      {articles.error !== null ? (
        <ErrorBanner title={t('common.refreshFailed')} error={articles.error} />
      ) : null}
      <Text variant="heading" accessibilityRole="header">
        {text.title}
      </Text>
      {text.language === language ? null : (
        <Text variant="caption" tone="secondary">
          {t('knowledge.originalOnly')}
        </Text>
      )}
      <KbBody body={text.body} />
    </ScrollView>
  );
}

const layout = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
