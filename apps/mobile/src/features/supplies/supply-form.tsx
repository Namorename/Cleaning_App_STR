import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import {
  MAX_SUPPLY_ITEM_COMMENT,
  MAX_SUPPLY_ITEM_NAME,
  MAX_SUPPLY_NOTE,
  SUPPLY_PRIORITIES,
  SUPPLY_UNITS,
  supplyDraftIssue,
  type SupplyDraft,
  type SupplyItemDraft,
} from './schema';

interface SupplyFormProps {
  draft: SupplyDraft;
  onChange: (draft: SupplyDraft) => void;
  onAddItem: () => void;
  /** Where the supplies are for, when known; the form does not let her change it. */
  place: string | null;
  isSubmitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
  error: Error | null;
}

/**
 * What she needs, line by line.
 *
 * Presentational: the route owns the draft. At least one filled line is what
 * the server insists on; the button stays grey until it is there. Urgency is
 * explained in words, not only by colour.
 */
export function SupplyForm({
  draft,
  onChange,
  onAddItem,
  place,
  isSubmitting,
  submitLabel,
  onSubmit,
  error,
}: SupplyFormProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const issue = supplyDraftIssue(draft);
  const canSubmit = issue === null && !isSubmitting;
  const failure = error === null ? null : serverErrorText(error);

  const updateItem = (key: string, patch: Partial<SupplyItemDraft>) =>
    onChange({
      ...draft,
      items: draft.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    });

  const removeItem = (key: string) =>
    onChange({ ...draft, items: draft.items.filter((item) => item.key !== key) });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {place !== null ? <Text style={styles.place}>{place}</Text> : null}

      <Text style={styles.label}>{t('supplies.itemsLabel')}</Text>
      {draft.items.map((item, index) => (
        <View key={item.key} style={styles.item}>
          <TextInput
            accessibilityLabel={t('supplies.itemNameAccessibility', { index: index + 1 })}
            editable={!isSubmitting}
            maxLength={MAX_SUPPLY_ITEM_NAME}
            onChangeText={(name) => updateItem(item.key, { name })}
            placeholder={t('supplies.itemNamePlaceholder')}
            placeholderTextColor={styles.hint.color}
            style={styles.input}
            value={item.name}
          />
          <View style={styles.quantityRow}>
            <TextInput
              accessibilityLabel={t('supplies.quantityAccessibility', { index: index + 1 })}
              editable={!isSubmitting}
              keyboardType="decimal-pad"
              onChangeText={(quantity) => updateItem(item.key, { quantity })}
              style={[styles.input, styles.quantity]}
              value={item.quantity}
            />
            <View style={styles.units} accessibilityRole="radiogroup">
              {SUPPLY_UNITS.map((unit) => {
                const selected = item.unit === unit;
                const label = t(`supplies.units.${unit}`);
                return (
                  <Pressable
                    key={unit}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ selected, checked: selected, disabled: isSubmitting }}
                    disabled={isSubmitting}
                    onPress={() => updateItem(item.key, { unit })}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <TextInput
            accessibilityLabel={t('supplies.itemCommentAccessibility', { index: index + 1 })}
            editable={!isSubmitting}
            maxLength={MAX_SUPPLY_ITEM_COMMENT}
            onChangeText={(comment) => updateItem(item.key, { comment })}
            placeholder={t('supplies.itemCommentPlaceholder')}
            placeholderTextColor={styles.hint.color}
            style={styles.input}
            value={item.comment}
          />
          {draft.items.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('supplies.removeItem')}
              disabled={isSubmitting}
              onPress={() => removeItem(item.key)}
              style={styles.link}
            >
              <Text style={styles.linkText}>{t('supplies.removeItem')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('supplies.addItem')}
        disabled={isSubmitting}
        onPress={onAddItem}
        style={({ pressed }) => [styles.secondary, pressed && styles.buttonPressed]}
      >
        <Text style={styles.secondaryText}>{t('supplies.addItem')}</Text>
      </Pressable>

      <View style={styles.field}>
        <Text style={styles.label}>{t('supplies.priorityLabel')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {SUPPLY_PRIORITIES.map((priority) => {
            const selected = draft.priority === priority;
            const label = t(`supplies.priorities.${priority}`);
            return (
              <Pressable
                key={priority}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ selected, checked: selected, disabled: isSubmitting }}
                disabled={isSubmitting}
                onPress={() => onChange({ ...draft, priority })}
                style={[styles.chip, styles.chipWide, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>{t('supplies.priorityHint')}</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t('supplies.noteLabel')}</Text>
        <TextInput
          accessibilityLabel={t('supplies.noteLabel')}
          editable={!isSubmitting}
          maxLength={MAX_SUPPLY_NOTE}
          multiline
          onChangeText={(note) => onChange({ ...draft, note })}
          placeholder={t('supplies.notePlaceholder')}
          placeholderTextColor={styles.hint.color}
          style={[styles.input, styles.inputMultiline]}
          textAlignVertical="top"
          value={draft.note}
        />
      </View>

      {issue === 'itemInvalid' ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {t('supplies.itemInvalidHint')}
        </Text>
      ) : null}

      {failure !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.failure}>
          <Text style={styles.error}>{failure.text}</Text>
          {failure.detail !== null ? (
            <Text style={styles.errorDetail}>{failure.detail}</Text>
          ) : null}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.button,
          !canSubmit && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        {isSubmitting ? (
          <ActivityIndicator color={styles.buttonText.color} />
        ) : (
          <Text style={styles.buttonText}>{submitLabel}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const NOTE_MIN_HEIGHT = 96;
const QUANTITY_WIDTH = 80;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.md },
    place: { color: theme.textSecondary, fontSize: FontSize.body },
    field: { gap: Spacing.xs },
    label: { color: theme.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
    hint: { color: theme.textSecondary, fontSize: FontSize.body },
    item: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.md,
      gap: Spacing.sm,
    },
    input: {
      minHeight: MIN_TOUCH_TARGET,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      fontSize: FontSize.title,
      color: theme.text,
      backgroundColor: theme.background,
    },
    inputMultiline: { minHeight: NOTE_MIN_HEIGHT, backgroundColor: theme.card },
    quantityRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
    quantity: { width: QUANTITY_WIDTH, textAlign: 'center' },
    units: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    chips: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
    chip: {
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.background,
      justifyContent: 'center',
    },
    chipWide: { paddingHorizontal: Spacing.lg, backgroundColor: theme.card },
    chipSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
    chipText: { color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    chipTextSelected: { color: theme.onPrimary },
    link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    linkText: { color: theme.danger, fontSize: FontSize.body, fontWeight: '600' },
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
    buttonDisabled: { opacity: 0.5 },
    buttonPressed: { opacity: 0.75 },
    buttonText: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
    secondary: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: { color: theme.primary, fontSize: FontSize.title, fontWeight: '600' },
  });
