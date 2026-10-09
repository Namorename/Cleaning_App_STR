import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState, type EmptyStateProps } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { BoardCard } from './board-card';
import type { BoardProblem, BoardSection } from './schema';

interface BoardListProps {
  sections: BoardSection[] | undefined;
  names: ReadonlyMap<string, string>;
  isLoading: boolean;
  /** A failure of the board, or of the names on it. */
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onPress: (problemId: string) => void;
  unreadProblemIds?: ReadonlySet<string>;
  /** What an empty answer says: no tasks at all, or none under the filters. */
  empty: EmptyStateProps;
  /** «Ещё» under the list, while there is a next page to read (the archive). */
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  /** Lines above the cards, already in his language: a part of the board read to its limit, say. */
  notices?: readonly string[];
}

const NO_NOTICES: readonly string[] = [];

/**
 * The board's cards, live first and the closed under their heading, as her own
 * list draws them (problem-list.tsx): loading, a list that never came and an
 * empty one are three different answers, a failed refresh a line above the list.
 */
export function BoardList({
  sections,
  names,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  onPress,
  unreadProblemIds,
  empty,
  onLoadMore,
  isLoadingMore = false,
  notices = NO_NOTICES,
}: BoardListProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const renderItem = useCallback(
    ({ item }: { item: BoardProblem }) => (
      <BoardCard
        problem={item}
        names={names}
        onPress={onPress}
        hasUnread={unreadProblemIds?.has(item.id) ?? false}
      />
    ),
    [names, onPress, unreadProblemIds],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: BoardSection }) =>
      section.key === 'closed' ? (
        <Text
          variant="caption"
          tone="secondary"
          weight={700}
          accessibilityRole="header"
          style={styles.heading}
        >
          {t('problems.closedHeading')}
        </Text>
      ) : null,
    [t],
  );

  if (isLoading) {
    return <ListSkeleton label={t('problems.loading')} />;
  }

  if (error !== null && sections === undefined) {
    return <ErrorState error={error} onRetry={onRefresh} />;
  }

  const listHeader =
    error === null && notices.length === 0 ? undefined : (
      <>
        {error === null ? null : <ErrorBanner title={t('common.refreshFailed')} error={error} />}
        {notices.map((notice) => (
          <Text key={notice} variant="caption" tone="secondary" style={styles.notice}>
            {notice}
          </Text>
        ))}
      </>
    );

  return (
    <SectionList
      sections={sections ?? []}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      ListHeaderComponent={listHeader}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={theme.textSecondary}
          colors={[theme.textSecondary]}
        />
      }
      ListEmptyComponent={<EmptyState {...empty} />}
      ListFooterComponent={
        onLoadMore === undefined ? undefined : (
          <Button
            variant="outline"
            label={t('problems.board.more')}
            isBusy={isLoadingMore}
            onPress={onLoadMore}
            style={styles.more}
          />
        )
      }
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

/** Three cards' worth of shape: a title, the pills, a line or two. */
const SKELETON_CARD = 120;
const SKELETON_CARDS = 3;

interface ListSkeletonProps {
  label: string;
}

function ListSkeleton({ label }: ListSkeletonProps) {
  return (
    <SkeletonGroup label={label} style={styles.skeleton}>
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <Skeleton key={index} height={SKELETON_CARD} radius={Radius.card} />
      ))}
    </SkeletonGroup>
  );
}

/** Sizes only: the colours are the components'. */
const styles = StyleSheet.create({
  content: { padding: Spacing.lg, flexGrow: 1 },
  heading: {
    textTransform: 'uppercase',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  separator: { height: Spacing.md },
  more: { marginTop: Spacing.lg },
  notice: { marginBottom: Spacing.md },
  skeleton: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
});
