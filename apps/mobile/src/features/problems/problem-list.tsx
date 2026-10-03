import { useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { ProblemCard } from './problem-card';
import type { Problem, ProblemGroup } from './schema';

interface ProblemListProps {
  sections: ProblemGroup[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onPress: (problemId: string) => void;
  header?: ReactElement;
  /** The reports somebody has written about since she last looked. */
  unreadProblemIds?: ReadonlySet<string>;
}

/**
 * Her reports, live ones first. Loading, error and empty are three different
 * answers, all of them text a screen reader can reach.
 */
export function ProblemList({
  sections,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  onPress,
  header,
  unreadProblemIds,
}: ProblemListProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

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
        <Text style={styles.heading}>{t('problems.closedHeading')}</Text>
      ) : null,
    [styles, t],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('problems.loading')}</Text>
      </View>
    );
  }

  if (error !== null && sections === undefined) {
    return <ErrorState error={error} />;
  }

  // Error over cache: a refresh that failed still has the list from the last
  // time it loaded, kept on the phone. The list stays, and a line above it
  // says what happened; the error screen above is for a list never loaded.
  const listHeader =
    error === null ? (
      header
    ) : (
      <>
        <ErrorBanner title={t('common.refreshFailed')} error={error} />
        {header}
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
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.message}>{t('problems.emptyMine')}</Text>
        </View>
      }
    />
  );
}

function Separator() {
  const styles = useThemedStyles(createStyles);
  return <View style={styles.separator} />;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    content: { padding: Spacing.lg, flexGrow: 1 },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.sm,
    },
    message: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
    heading: {
      color: theme.textSecondary,
      fontSize: FontSize.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    separator: { height: Spacing.md },
  });
