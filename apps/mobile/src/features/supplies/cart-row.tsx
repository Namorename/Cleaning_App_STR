import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { ROW_HEIGHT, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { QuantityStepper, type QuantityStepperProps } from './quantity-stepper';

/** The stripe that marks a row in the request, beside the bolder name and the number. */
const CHOSEN_STRIPE = 4;

export interface CartRowViewProps extends Omit<QuantityStepperProps, 'name'> {
  title: string;
  /** The unit, as she reads it: "упак". */
  unit: string;
  /** A line she typed herself opens in the sheet it was typed in. */
  onEdit?: () => void;
}

/**
 * One row of the cart: what it is and its unit on the left, the stepper on
 * the right; 64 dp like any row of a list. A row in the request is marked by
 * more than a colour — its number, a bolder name, a stripe at its edge.
 */
export function CartRowView({ title, unit, onEdit, ...stepper }: CartRowViewProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const lines = (
    <>
      <Text weight={stepper.isInRequest ? 700 : undefined}>{title}</Text>
      <Text variant="caption" tone="secondary">
        {unit}
      </Text>
    </>
  );

  return (
    <View style={styles.row}>
      {stepper.isInRequest ? <View style={styles.stripe} /> : null}
      {onEdit !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('supplies.editLineAccessibility', { name: title })}
          disabled={stepper.isDisabled}
          onPress={onEdit}
          style={({ pressed }) => [styles.lines, styles.edit, pressed && styles.pressed]}
        >
          {lines}
        </Pressable>
      ) : (
        <View style={styles.lines}>{lines}</View>
      )}
      <QuantityStepper name={title} {...stepper} />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    stripe: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: CHOSEN_STRIPE,
      backgroundColor: theme.primary,
    },
    lines: { flex: 1, gap: 2 },
    // The whole left of the row is the target, not just the words.
    edit: { alignSelf: 'stretch', justifyContent: 'center' },
    pressed: { opacity: 0.6 },
  });
