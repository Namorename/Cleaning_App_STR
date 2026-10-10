import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { useScreenEdgePadding } from '@/components/bottom-inset';
import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { staffNames } from '@/features/board/format';
import { useStaffDirectory } from '@/features/board/use-board';
import { formatReportedAt } from '@/features/problems/format';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { historySince, historyWhat, historyWho } from './lines';
import { FIRST_EVENT, type ProblemEvent } from './schema';
import { useProblemEvents } from './use-history';

interface ProblemHistoryProps {
  problemId: string;
}

interface Line {
  id: number;
  who: string;
  what: string;
  when: string;
}

/**
 * A task's journal (brief, item 3): oldest first, each line who did what and
 * when, the names from the directory, the dates in the phone's language. The
 * journal began with the rollout and the past was not reconstructed
 * (docs/tech-plan.md §3.1): a task older than that says where its history
 * starts, above the lines or as the empty state's words.
 */
export function ProblemHistory({ problemId }: ProblemHistoryProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  // The last line, scrolled to the end, stops clear of the system's bar
  // (components/bottom-inset.ts).
  const end = useScreenEdgePadding(Spacing.lg);
  const events = useProblemEvents(problemId);
  const staff = useStaffDirectory();
  const names = useMemo(() => staffNames(staff.data, t), [staff.data, t]);

  const lines = useMemo<Line[] | undefined>(
    () =>
      events.data?.map((event: ProblemEvent) => ({
        id: event.id,
        who: historyWho(event, names),
        what: historyWhat(event, names),
        when: formatReportedAt(event.created_at),
      })),
    [events.data, names],
  );

  const { refetch: refetchEvents } = events;
  const { refetch: refetchStaff } = staff;
  const onRefresh = useCallback(() => {
    void refetchEvents();
    void refetchStaff();
  }, [refetchEvents, refetchStaff]);

  const since = historySince();

  if (events.isPending) {
    return (
      <View style={styles.screen}>
        <SkeletonGroup label={t('problems.history.loading')} style={styles.skeleton}>
          {Array.from({ length: SKELETON_LINES }, (_, index) => (
            <Skeleton key={index} height={SKELETON_LINE} />
          ))}
        </SkeletonGroup>
      </View>
    );
  }

  if (events.error !== null && lines === undefined) {
    return (
      <View style={styles.screen}>
        <ErrorState error={events.error} onRetry={onRefresh} />
      </View>
    );
  }

  const failure = events.error ?? staff.error ?? null;
  const hasBeginning = events.data?.[0]?.kind === FIRST_EVENT;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, end]}
      data={lines ?? []}
      keyExtractor={(line) => String(line.id)}
      renderItem={({ item }) => <HistoryLine line={item} />}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        <View style={styles.header}>
          {failure !== null ? (
            <ErrorBanner title={t('common.refreshFailed')} error={failure} />
          ) : null}
          {(lines?.length ?? 0) > 0 && !hasBeginning ? (
            <Text variant="caption" tone="secondary">
              {since}
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={<EmptyState title={t('problems.history.empty')} message={since} />}
      refreshControl={
        <RefreshControl
          refreshing={events.isRefetching}
          onRefresh={onRefresh}
          tintColor={theme.textSecondary}
          colors={[theme.textSecondary]}
        />
      }
    />
  );
}

interface HistoryLineProps {
  line: Line;
}

/** One event: the person, what happened, when — read as one line in that order. */
function HistoryLine({ line }: HistoryLineProps) {
  return (
    <View
      testID="history-line"
      accessible
      accessibilityLabel={`${line.who}. ${line.what}. ${line.when}`}
      style={layout.line}
    >
      <Text weight={700}>{line.who}</Text>
      <Text>{line.what}</Text>
      <Text variant="caption" tone="secondary">
        {line.when}
      </Text>
    </View>
  );
}

function Separator() {
  const styles = useThemedStyles(createStyles);
  return <View style={styles.separator} />;
}

/** Five lines' worth of shape while the journal loads. */
const SKELETON_LINES = 5;
const SKELETON_LINE = 64;

/** Sizes only. */
const layout = StyleSheet.create({
  line: { gap: 2, paddingVertical: Spacing.md },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, flexGrow: 1 },
    header: { gap: Spacing.sm, paddingTop: Spacing.lg },
    skeleton: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.divider },
  });
