import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import {
  isLineValid,
  MAX_SUPPLY_ITEM_NAME,
  SUPPLY_UNITS,
  type SupplyItemDraft,
  type SupplyUnit,
} from './schema';

/** One opening of the sheet: a fresh line to add, or her own line to change. */
export interface LineEditor {
  /** Each opening counts up, so the fields start from `line` every time. */
  id: number;
  line: SupplyItemDraft;
  isNew: boolean;
}

interface LineSheetProps {
  isVisible: boolean;
  /** The last opening; kept while the sheet fades out, so it does not empty first. */
  editor: LineEditor | null;
  onConfirm: (line: SupplyItemDraft) => void;
  onClose: () => void;
}

/**
 * A line that is not in the catalogue (owner's variant 1: manual entry is the
 * last row of the list): its name, its unit as the chips it always had, and
 * how many. «Добавить» puts it into the request under the rule every line is
 * held to; a line of her own opens here again to be changed.
 */
export function LineSheet({ isVisible, editor, onConfirm, onClose }: LineSheetProps) {
  const { t } = useTranslation();

  return (
    <BottomSheet
      testID="supply-line-sheet"
      isVisible={isVisible}
      title={t('supplies.manualTitle')}
      onClose={onClose}
    >
      {editor !== null ? (
        <LineFields
          key={editor.id}
          initial={editor.line}
          confirmLabel={editor.isNew ? t('supplies.addLine') : t('supplies.save')}
          onConfirm={onConfirm}
        />
      ) : null}
    </BottomSheet>
  );
}

interface LineFieldsProps {
  initial: SupplyItemDraft;
  confirmLabel: string;
  onConfirm: (line: SupplyItemDraft) => void;
}

function LineFields({ initial, confirmLabel, onConfirm }: LineFieldsProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const [name, setName] = useState(initial.name);
  const [unit, setUnit] = useState<SupplyUnit>(initial.unit);
  const [quantity, setQuantity] = useState(initial.quantity);
  const line: SupplyItemDraft = { ...initial, name: name.trim(), unit, quantity };

  return (
    <View style={styles.fields}>
      <TextField
        label={t('supplies.itemNameLabel')}
        placeholder={t('supplies.itemNamePlaceholder')}
        maxLength={MAX_SUPPLY_ITEM_NAME}
        value={name}
        onChangeText={setName}
      />
      <View style={styles.field}>
        <Text tone="secondary">{t('supplies.unitLabel')}</Text>
        <View
          style={styles.chips}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('supplies.unitLabel')}
        >
          {SUPPLY_UNITS.map((option) => (
            <UnitChip
              key={option}
              label={t(`supplies.units.${option}`)}
              isSelected={unit === option}
              onSelect={() => setUnit(option)}
              styles={styles}
            />
          ))}
        </View>
      </View>
      <TextField
        label={t('supplies.quantityLabel')}
        keyboardType="decimal-pad"
        selectTextOnFocus
        value={quantity}
        onChangeText={setQuantity}
      />
      <Button
        label={confirmLabel}
        onPress={() => onConfirm(line)}
        isDisabled={!isLineValid(line)}
      />
    </View>
  );
}

interface UnitChipProps {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  styles: ReturnType<typeof createStyles>;
}

function UnitChip({ label, isSelected, onSelect, styles }: UnitChipProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected, checked: isSelected }}
      onPress={onSelect}
      style={[styles.chip, isSelected && styles.chipSelected]}
    >
      <Text weight={600} tone={isSelected ? 'onPrimary' : 'default'}>
        {label}
      </Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    fields: { gap: Spacing.md },
    field: { gap: Spacing.xs },
    chips: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
    chip: {
      minHeight: MIN_TOUCH_TARGET,
      minWidth: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  });
