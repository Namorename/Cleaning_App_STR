import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing, type Theme } from '@/constants/theme';
import { formatReportedAt } from '@/features/problems/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { itemsSummary, supplyPlace, supplyPriorityText, supplyStatusText } from './format';
import type { SupplyRequest } from './schema';

interface SupplyCardProps {
  request: SupplyRequest;
  onPress: (requestId: string) => void;
}

function SupplyCardComponent({ request, onPress }: SupplyCardProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const status = supplyStatusText(request.status);
  const place = supplyPlace(request);
  const summary = itemsSummary(request.items);
  const urgent = request.priority === 'urgent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('supplies.cardAccessibility', { place, summary, status })}
      onPress={() => onPress(request.id)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.header}>
        <Text style={styles.place}>{place}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{status}</Text>
        </View>
      </View>
      <Text style={styles.summary} numberOfLines={3}>
        {summary}
      </Text>
      <Text style={[styles.meta, urgent && styles.urgent]}>
        {formatReportedAt(request.created_at)}
        {urgent ? ` · ${supplyPriorityText(request.priority)}` : ''}
      </Text>
    </Pressable>
  );
}

export const SupplyCard = memo(SupplyCardComponent);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.lg,
      gap: Spacing.xs,
    },
    cardPressed: { opacity: 0.8 },
    header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
    place: { flex: 1, color: theme.text, fontSize: FontSize.title, fontWeight: '700' },
    badge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.calmSurface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    badgeText: { color: theme.calmText, fontSize: FontSize.caption, fontWeight: '600' },
    summary: { color: theme.text, fontSize: FontSize.body },
    meta: { color: theme.textSecondary, fontSize: FontSize.caption },
    urgent: { color: theme.urgentText, fontWeight: '700' },
  });
