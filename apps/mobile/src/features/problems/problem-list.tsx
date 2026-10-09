import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ProblemCard } from './problem-card';
import type { Problem, ProblemGroup } from './schema';

interface ProblemListProps {
  sections: ProblemGroup[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onPress: (problemId: string) => void;
  /** The reports somebody has written about since she last looked. */
  unreadProblemIds?: ReadonlySet<string>;
}

/**
 * Her reports, live ones first. Loading, error and empty are three different
 * answers — the cards' shape said as loading, the error state, the empty
 * state — all of them something a screen reader can reach.
 */
export function ProblemList({
  sections,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  onPress,
  unreadProblemIds,
}: ProblemListProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const renderItem = useCallback(
    ({ item }: { item: Problem }) => (
      <ProblemCard
        problem={item}
        onPress={onPress}
        hasUnread={unreadProblemIds?.has(item.id) ?? false}
      />
    ),
    [onPress, unreadProblemIds],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: ProblemGroup }) =>
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

  // Error over cache: a refresh that failed still has the list from the last
  // time it loaded, kept on the phone. The list stays, and a line above it
  // says what happened; the error screen above is for a list never loaded.
  // «Создать задание» is not a row of the list: the screen pins it below.
  const listHeader =
    error === null ? undefined : <ErrorBanner title={t('common.refreshFailed')} error={error} />;

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
        // The platform's spinner is a dark tick on iOS without a tint: invisible in the dark.
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={theme.textSecondary}
          colors={[theme.textSecondary]}
        />
      }
      ListEmptyComponent={<EmptyState title={t('problems.emptyMine')} />}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

/** Three cards' worth of shape: a title line, a line, a chip. */
const SKELETON_CARD = 96;
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
  skeleton: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
});
