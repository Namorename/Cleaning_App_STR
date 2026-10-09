import { problemPriorityTone, problemStatusTone } from '@str-ops/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorBanner } from '@/components/error-banner';
import { FailureText } from '@/components/failure-text';
import { Icon } from '@/components/icon';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { BUTTON_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
import { MediaStrip, type StripItem } from '@/features/media/media-strip';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatReportedAt, problemPlace, problemPriorityText, problemStatusText } from './format';
import { MAX_PROBLEM_PHOTOS, type Problem } from './schema';

interface ProblemDetailProps {
  problem: Problem;
  photos: readonly StripItem[];
  /** True for the reporter while the report is open: she may still change it. */
  canEdit: boolean;
  onEdit: () => void;
  onCapture: () => void;
  onPickFromGallery?: () => void;
  onRemovePhoto: (mediaId: string) => void;
  onRetryPhoto: (mediaId: string) => void;
  isCapturing: boolean;
  /** The task that fixes it, when it is the reader's own. */
  fixTaskId: string | null;
  onOpenFixTask: (taskId: string) => void;
  /** The conversation about this report; the repair speaks in the same one. */
  onOpenChat?: () => void;
  error: Error | null;
  notice: string | null;
  /**
   * A refresh that failed over the report still on screen: said above it, the
   * report stays (a failure to load at all is the route's error state).
   */
  refreshError?: Error | null;
}

/**
 * One report, as it stands.
 *
 * Presentational: the route wires the camera and the queue in. Photos can be
 * added and taken back only while the report is open, the same rule the
 * server applies; afterwards the strip is a record. The layout is the one it
 * had (redesign-plan §4.2): the status a pill in its own tone, «Срочно» a pill
 * of its own, the work that fixes it the main button, the rest outlined.
 */
export function ProblemDetail({
  problem,
  photos,
  canEdit,
  onEdit,
  onCapture,
  onPickFromGallery,
  onRemovePhoto,
  onRetryPhoto,
  isCapturing,
  fixTaskId,
  onOpenFixTask,
  onOpenChat,
  error,
  notice,
  refreshError = null,
}: ProblemDetailProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={layout.content}>
      {/* Error over cache, as the lists have it: the saved report stays. This
          screen has no pull-to-refresh, so the line does not ask for one. */}
      {refreshError !== null ? (
        <ErrorBanner title={t('common.refreshFailedSaved')} error={refreshError} />
      ) : null}

      <Text variant="heading">{problem.title}</Text>
      <Text tone="secondary">
        {problemPlace(problem)} · {formatReportedAt(problem.created_at)}
      </Text>

      {problem.priority === 'high' ? (
        // The word the task screen and the supply request use for the same flag.
        <Badge
          testID="problem-urgent"
          label={t('supplies.priorities.urgent')}
          tone={problemPriorityTone('high')}
        />
      ) : null}

      <Card>
        <Fact label={t('problems.statusLabel')}>
          <Badge
            testID="problem-status"
            label={problemStatusText(problem.status)}
            tone={problemStatusTone(problem.status)}
          />
        </Fact>
        <Fact label={t('problems.priorityLabel')}>
          <Text align="right" style={layout.value}>
            {problemPriorityText(problem.priority)}
          </Text>
        </Fact>
        {problem.cancel_reason !== null ? (
          <Fact label={t('problems.cancelReason')}>
            <Text align="right" style={layout.value}>
              {problem.cancel_reason}
            </Text>
          </Fact>
        ) : null}
      </Card>

      {problem.description !== null ? (
        <View style={layout.block}>
          <BlockLabel text={t('problems.descriptionLabel')} />
          <Text>{problem.description}</Text>
        </View>
      ) : null}

      <View style={layout.block}>
        <BlockLabel text={t('problems.photosLabel')} />
        {photos.length === 0 && !canEdit ? (
          <Text tone="secondary">{t('problems.noPhotos')}</Text>
        ) : null}
        <MediaStrip
          items={photos}
          maxCount={MAX_PROBLEM_PHOTOS}
          onCapture={canEdit ? onCapture : undefined}
          onPickFromGallery={canEdit ? onPickFromGallery : undefined}
          onRemove={canEdit ? onRemovePhoto : undefined}
          onRetry={canEdit ? onRetryPhoto : undefined}
          isCapturing={isCapturing}
        />
      </View>

      {notice !== null ? (
        <Text accessibilityLiveRegion="polite" tone="secondary">
          {notice}
        </Text>
      ) : null}

      {/* The last move's failure, next to the buttons. */}
      {error !== null ? <FailureText error={error} /> : null}

      {fixTaskId !== null ? (
        <Button label={t('problems.openFixTask')} onPress={() => onOpenFixTask(fixTaskId)} />
      ) : null}

      {onOpenChat !== undefined ? (
        <Button
          variant="outline"
          label={t('problems.openChat')}
          left={<Icon name="action.openChat" tone="primary" />}
          onPress={onOpenChat}
        />
      ) : null}

      {canEdit ? <Button variant="outline" label={t('problems.edit')} onPress={onEdit} /> : null}
    </ScrollView>
  );
}

interface FactProps {
  label: string;
  children: ReactNode;
}

/** A fact and its value on one line; at a large font the value wraps under it. */
function Fact({ label, children }: FactProps) {
  return (
    <View style={layout.fact}>
      <Text tone="secondary" style={layout.shrink}>
        {label}
      </Text>
      {children}
    </View>
  );
}

interface BlockLabelProps {
  text: string;
}

function BlockLabel({ text }: BlockLabelProps) {
  return (
    <Text variant="caption" tone="secondary" weight={700}>
      {text}
    </Text>
  );
}

/** The skeleton's blocks: the title, a line, the facts' card, a button. */
const SKELETON_HEADING = 28;
const SKELETON_LINE = 16;
const SKELETON_CARD = 96;

interface ProblemDetailSkeletonProps {
  /** What is loading, said to the reader. */
  label: string;
}

/** The report's shape while it loads (the task screen's, `TaskDetailSkeleton`). */
export function ProblemDetailSkeleton({ label }: ProblemDetailSkeletonProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.screen}>
      <SkeletonGroup label={label} style={layout.content}>
        <Skeleton height={SKELETON_HEADING} width="70%" />
        <Skeleton height={SKELETON_LINE} width="45%" />
        <Skeleton height={SKELETON_CARD} radius={Radius.card} />
        <Skeleton height={BUTTON_HEIGHT} radius={Radius.pill} />
      </SkeletonGroup>
    </View>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  fact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: Spacing.md,
    rowGap: Spacing.xs,
  },
  shrink: { flexShrink: 1 },
  value: { flexShrink: 1 },
  block: { gap: Spacing.xs },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
