import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { SupplyCard } from './supply-card';
import type { SupplyGroup, SupplyRequest } from './schema';

interface SupplyListProps {
  sections: SupplyGroup[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onPress: (requestId: string) => void;
  /** Starts a new request: the button above the cards, or the empty state's. */
  onRequest?: () => void;
}

/**
 * Her requests, live ones first, closed ones under their own heading.
 * Loading, error and empty are three different answers — the cards' shape
 * said as loading, the error state, the empty state — all of them something a
 * screen reader can reach. «Запросить расходники» stands above the cards as it
 * always did; with no cards it is the empty state's own button, not a second one.
 */
export function SupplyList({
  sections,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  onPress,
  onRequest,
}: SupplyListProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const renderItem = useCallback(
    ({ item }: { item: SupplyRequest }) => <SupplyCard request={item} onPress={onPress} />,
    [onPress],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SupplyGroup }) =>
      section.key === 'closed' ? (
        <Text
          variant="caption"
          tone="secondary"
          weight={700}
          accessibilityRole="header"
          style={styles.heading}
        >
          {t('supplies.closedHeading')}
        </Text>
      ) : null,
    [t],
  );

  if (isLoading) {
    return <ListSkeleton label={t('supplies.loading')} />;
  }

  if (error !== null && sections === undefined) {
    return <ErrorState error={error} onRetry={onRefresh} />;
  }

  const hasRequests = (sections ?? []).some((section) => section.data.length > 0);
  const request =
    onRequest === undefined ? undefined : { label: t('supplies.request'), onPress: onRequest };

  // Error over cache: a refresh that failed still has the list from the last
  // time it loaded, kept on the phone. The list stays, and a line above it
  // says what happened; the error screen above is for a list never loaded.
  const listHeader = (
    <>
      {error === null ? null : <ErrorBanner title={t('common.refreshFailed')} error={error} />}
      {hasRequests && request !== undefined ? (
        <Button label={request.label} onPress={request.onPress} style={styles.request} />
      ) : null}
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
        // The platform's spinner is a dark tick on iOS without a tint: invisible in the dark.
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={theme.textSecondary}
          colors={[theme.textSecondary]}
        />
      }
      ListEmptyComponent={<EmptyState title={t('supplies.emptyMine')} action={request} />}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

/** Three cards' worth of shape: the place, the lines, the date. */
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
  request: { marginBottom: Spacing.md },
  separator: { height: Spacing.md },
  skeleton: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
});
