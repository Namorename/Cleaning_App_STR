import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { SUPPLY_PRIORITIES, type SupplyPriority } from './schema';

interface PriorityChipsProps {
  value: SupplyPriority;
  onChange: (priority: SupplyPriority) => void;
  isDisabled: boolean;
}

/**
 * The request's urgency, as it always was: two radios, «Обычная» and
 * «Срочно», said in words rather than by a colour. What «Срочно» means is the
 * reader's hint here; the request sheet spells it out under the same switch.
 */
export function PriorityChips({ value, onChange, isDisabled }: PriorityChipsProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  return (
    <View
      style={styles.chips}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('supplies.priorityLabel')}
    >
      {SUPPLY_PRIORITIES.map((priority) => {
        const isSelected = value === priority;
        const label = t(`supplies.priorities.${priority}`);
        return (
          <Pressable
            key={priority}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityHint={priority === 'urgent' ? t('supplies.priorityHint') : undefined}
            accessibilityState={{ selected: isSelected, checked: isSelected, disabled: isDisabled }}
            disabled={isDisabled}
            onPress={() => onChange(priority)}
            style={[styles.chip, isSelected && styles.chipSelected]}
          >
            <Text weight={600} tone={isSelected ? 'onPrimary' : 'default'}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    chips: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
    chip: {
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      justifyContent: 'center',
    },
    chipSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  });
