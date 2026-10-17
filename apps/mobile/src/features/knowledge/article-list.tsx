import { router } from 'expo-router';
import { useCallback, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, type ListRenderItem } from 'react-native';

import { useScreenEdgePadding } from '@/components/bottom-inset';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { currentLanguage } from '@/i18n';

import { articleExcerpt, readArticleText, type KbArticle } from './schema';

interface ArticleRowProps {
  article: KbArticle;
}

/** One article in a list: its title in the reader's language and the start of its text. */
function ArticleRow({ article }: ArticleRowProps) {
  const text = readArticleText(article, currentLanguage());
  return (
    <ListRow
      title={text.title}
      subtitle={articleExcerpt(text.body)}
      right={<Icon name="action.next" tone="secondary" />}
      onPress={() =>
        router.push({ pathname: '/knowledge/article/[id]', params: { id: article.id } })
      }
    />
  );
}

interface ArticleListProps {
  /** In the order to show them. */
  articles: readonly KbArticle[];
  /** A pull to refresh is on its way. */
  isRefreshing: boolean;
  /** Asks again: what the failed-refresh line above the rows tells her to do. */
  onRefresh: () => void;
  /** Above the rows: a search, a place's name, a failed refresh. */
  header?: ReactElement;
  /** Below the rows: the way to the rest of the base. */
  footer?: ReactElement;
  /** In place of the rows when there are none, saying why. */
  empty: ReactElement;
}

/** The articles of a screen of the base, each opening on a tap. */
export function ArticleList({
  articles,
  isRefreshing,
  onRefresh,
  header,
  footer,
  empty,
}: ArticleListProps) {
  const theme = useTheme();
  // The last row stops clear of the system's bar (components/bottom-inset.ts).
  const end = useScreenEdgePadding(Spacing.lg);
  const renderRow = useCallback<ListRenderItem<KbArticle>>(
    ({ item }) => <ArticleRow article={item} />,
    [],
  );

  return (
    <FlatList
      data={articles}
      keyExtractor={(article) => article.id}
      renderItem={renderRow}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
      contentContainerStyle={[layout.content, end]}
      contentInsetAdjustmentBehavior="automatic"
      // A tap on a row with the keyboard up opens the row, not just closes the keyboard.
      keyboardShouldPersistTaps="handled"
      // Scrolling the results puts the keyboard away, on both platforms.
      keyboardDismissMode="on-drag"
      refreshControl={
        // The platform's spinner is a dark tick on iOS without a tint: invisible in the dark.
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={theme.textSecondary}
          colors={[theme.textSecondary]}
        />
      }
    />
  );
}

const layout = StyleSheet.create({
  content: { paddingVertical: Spacing.lg, gap: Spacing.xs },
});
