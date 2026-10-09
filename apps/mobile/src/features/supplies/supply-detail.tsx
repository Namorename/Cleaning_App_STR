import { supplyPriorityTone, supplyStatusTone } from '@str-ops/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorBanner } from '@/components/error-banner';
import { FailureText } from '@/components/failure-text';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { BUTTON_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
import { formatReportedAt } from '@/features/problems/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatQuantity, supplyPlace, supplyPriorityText, supplyStatusText } from './format';
import type { SupplyRequest } from './schema';

interface SupplyDetailProps {
  request: SupplyRequest;
  /** True for the author while the request is new: she may still change or withdraw it. */
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  error: Error | null;
  /**
   * A refresh that failed over the request still on screen: said above it, the
   * request stays (a failure to load at all is the route's error state).
   */
  refreshError?: Error | null;
}

/**
 * One request, as it stands: the lines, its fate, and the manager's reason if
 * refused. The layout is the one it had: the facts on a card — the status a
 * pill in its own tone, «Срочно» a pill in the urgent tone — each line a card,
 * «Изменить» the main button and withdrawing the destructive one under it.
 */
export function SupplyDetail({
  request,
  canEdit,
  onEdit,
  onDelete,
  isDeleting,
  error,
  refreshError = null,
}: SupplyDetailProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const items = request.items.slice().sort((a, b) => a.sort_order - b.sort_order);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={layout.content}>
      {/* Error over cache, as the lists have it: the saved request stays. This
          screen has no pull-to-refresh, so the line does not ask for one. */}
      {refreshError !== null ? (
        <ErrorBanner title={t('common.refreshFailedSaved')} error={refreshError} />
      ) : null}

      <Text variant="heading">{supplyPlace(request)}</Text>
      <Text tone="secondary">{formatReportedAt(request.created_at)}</Text>

      <Card>
        <Fact label={t('supplies.statusLabel')}>
          <Badge
            testID="supply-status"
            label={supplyStatusText(request.status)}
            tone={supplyStatusTone(request.status)}
          />
        </Fact>
        <Fact label={t('supplies.priorityLabel')}>
          {request.priority === 'urgent' ? (
            <Badge
              testID="supply-urgent"
              label={supplyPriorityText('urgent')}
              tone={supplyPriorityTone('urgent')}
            />
          ) : (
            <Text align="right" style={layout.value}>
              {supplyPriorityText(request.priority)}
            </Text>
          )}
        </Fact>
        {request.reject_reason !== null ? (
          <Fact label={t('supplies.rejectReason')}>
            <Text align="right" style={layout.value}>
              {request.reject_reason}
            </Text>
          </Fact>
        ) : null}
      </Card>

      <View style={layout.block}>
        <BlockLabel text={t('supplies.itemsLabel')} />
        {items.map((item) => (
          <Card key={item.id} testID={`supply-line-${item.id}`}>
            <View style={layout.line}>
              <Text weight={700} style={layout.shrink}>
                {item.name}
              </Text>
              <Text>{formatQuantity(item)}</Text>
            </View>
            {item.comment !== null ? (
              <Text variant="caption" tone="secondary">
                {item.comment}
              </Text>
            ) : null}
          </Card>
        ))}
      </View>

      {request.note !== null ? (
        <View style={layout.block}>
          <BlockLabel text={t('supplies.noteLabel')} />
          <Text>{request.note}</Text>
        </View>
      ) : null}

      {/* The last move's failure, next to the buttons. */}
      {error !== null ? <FailureText error={error} /> : null}

      {canEdit ? (
        <>
          <Button label={t('supplies.edit')} onPress={onEdit} isDisabled={isDeleting} />
          <Button
            variant="destructive"
            label={t('supplies.delete')}
            onPress={onDelete}
            isBusy={isDeleting}
          />
        </>
      ) : null}
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

/** The skeleton's blocks: the place, the date, the facts' card, a line, the button. */
const SKELETON_HEADING = 28;
const SKELETON_LINE = 16;
const SKELETON_FACTS = 96;
const SKELETON_ITEM = 56;

interface SupplyDetailSkeletonProps {
  /** What is loading, said to the reader. */
  label: string;
}

/** The request's shape while it loads (the report's, `ProblemDetailSkeleton`). */
export function SupplyDetailSkeleton({ label }: SupplyDetailSkeletonProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.screen}>
      <SkeletonGroup label={label} style={layout.content}>
        <Skeleton height={SKELETON_HEADING} width="70%" />
        <Skeleton height={SKELETON_LINE} width="45%" />
        <Skeleton height={SKELETON_FACTS} radius={Radius.card} />
        <Skeleton height={SKELETON_ITEM} radius={Radius.card} />
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
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
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
