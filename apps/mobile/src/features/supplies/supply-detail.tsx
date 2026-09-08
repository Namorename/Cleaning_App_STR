import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { formatReportedAt } from '@/features/problems/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

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
}

/** One request, as it stands: the lines, its fate, and the manager's reason if refused. */
export function SupplyDetail({
  request,
  canEdit,
  onEdit,
  onDelete,
  isDeleting,
  error,
}: SupplyDetailProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const failure = error === null ? null : serverErrorText(error);
  const items = request.items.slice().sort((a, b) => a.sort_order - b.sort_order);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{supplyPlace(request)}</Text>
      <Text style={styles.meta}>{formatReportedAt(request.created_at)}</Text>

      <View style={styles.facts}>
        <Fact
          label={t('supplies.statusLabel')}
          value={supplyStatusText(request.status)}
          styles={styles}
        />
        <Fact
          label={t('supplies.priorityLabel')}
          value={supplyPriorityText(request.priority)}
          styles={styles}
        />
        {request.reject_reason !== null ? (
          <Fact label={t('supplies.rejectReason')} value={request.reject_reason} styles={styles} />
        ) : null}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t('supplies.itemsLabel')}</Text>
        {items.map((item) => (
          <View key={item.id} style={styles.item}>
            <View style={styles.itemRow}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemQuantity}>{formatQuantity(item)}</Text>
            </View>
            {item.comment !== null ? <Text style={styles.itemComment}>{item.comment}</Text> : null}
          </View>
        ))}
      </View>

      {request.note !== null ? (
        <View style={styles.block}>
          <Text style={styles.label}>{t('supplies.noteLabel')}</Text>
          <Text style={styles.body}>{request.note}</Text>
        </View>
      ) : null}

      {failure !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.failure}>
          <Text style={styles.error}>{failure.text}</Text>
          {failure.detail !== null ? (
            <Text style={styles.errorDetail}>{failure.detail}</Text>
          ) : null}
        </View>
      ) : null}

      {canEdit ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('supplies.edit')}
            disabled={isDeleting}
            onPress={onEdit}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>{t('supplies.edit')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('supplies.delete')}
            accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
            disabled={isDeleting}
            onPress={onDelete}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            {isDeleting ? (
              <ActivityIndicator color={styles.secondaryText.color} />
            ) : (
              <Text style={styles.secondaryText}>{t('supplies.delete')}</Text>
            )}
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

interface FactProps {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}

function Fact({ label, value, styles }: FactProps) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.md },
    title: { color: theme.text, fontSize: FontSize.heading, fontWeight: '700' },
    meta: { color: theme.textSecondary, fontSize: FontSize.body },
    facts: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.lg,
      gap: Spacing.sm,
    },
    fact: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
    factLabel: { color: theme.textSecondary, fontSize: FontSize.body },
    factValue: {
      flex: 1,
      color: theme.text,
      fontSize: FontSize.body,
      fontWeight: '600',
      textAlign: 'right',
    },
    block: { gap: Spacing.xs },
    label: { color: theme.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
    body: { color: theme.text, fontSize: FontSize.body },
    item: {
      backgroundColor: theme.card,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.md,
      gap: Spacing.xs,
    },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
    itemName: { flex: 1, color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    itemQuantity: { color: theme.text, fontSize: FontSize.body },
    itemComment: { color: theme.textSecondary, fontSize: FontSize.caption },
    failure: { gap: Spacing.xs },
    error: { color: theme.danger, fontSize: FontSize.body, textAlign: 'center' },
    errorDetail: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'center' },
    button: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.75 },
    buttonText: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
    secondary: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: { color: theme.danger, fontSize: FontSize.title, fontWeight: '600' },
  });
