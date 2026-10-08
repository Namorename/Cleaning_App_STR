import { supplyPriorityTone, supplyStatusTone } from '@str-ops/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { formatReportedAt } from '@/features/problems/format';

import { itemsSummary, supplyPlace, supplyPriorityText, supplyStatusText } from './format';
import type { SupplyRequest } from './schema';

interface SupplyCardProps {
  request: SupplyRequest;
  onPress: (requestId: string) => void;
}

/**
 * A request in her list: one card, one button. The status is a pill in its
 * own tone (STATUS_TONE); an urgent request carries «Срочно» in the urgent
 * tone instead of a red tail on the date line — the pill the task screen and
 * the report use for the same flag.
 */
function SupplyCardComponent({ request, onPress }: SupplyCardProps) {
  const { t } = useTranslation();
  const status = supplyStatusText(request.status);
  const place = supplyPlace(request);
  const summary = itemsSummary(request.items);
  const isUrgent = request.priority === 'urgent';
  const urgent = supplyPriorityText('urgent');
  // The pill is a fact of the card, so the reader hears it with the rest.
  const label = [
    t('supplies.cardAccessibility', { place, summary, status }),
    isUrgent ? urgent : null,
  ]
    .filter((part) => part !== null)
    .join('. ');

  return (
    <Card accessibilityLabel={label} onPress={() => onPress(request.id)}>
      <View style={styles.header}>
        <Text variant="title" style={styles.place}>
          {place}
        </Text>
        <View style={styles.marks}>
          <Badge testID="supply-status" label={status} tone={supplyStatusTone(request.status)} />
          {isUrgent ? (
            <Badge testID="supply-urgent" label={urgent} tone={supplyPriorityTone('urgent')} />
          ) : null}
        </View>
      </View>
      <Text numberOfLines={3}>{summary}</Text>
      <Text variant="caption" tone="secondary">
        {formatReportedAt(request.created_at)}
      </Text>
    </Card>
  );
}

export const SupplyCard = memo(SupplyCardComponent);

/** Sizes only: the colours are the components'. */
const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  place: { flex: 1 },
  // The pills stack at the right, as on a report's card: side by side they
  // would leave the place no room at 320 dp.
  marks: { gap: Spacing.xs },
});
