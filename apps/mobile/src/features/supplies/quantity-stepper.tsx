import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text, useFontFace } from '@/components/text';
import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/** The weight of the number: it is what the row is about. */
const COUNT_WEIGHT = 700;

/** Room for "12,5" without the box changing size as she types. */
const COUNT_MIN_WIDTH = 64;

export interface QuantityStepperProps {
  /** The line's name: every control says which line it acts on. */
  name: string;
  /** The quantity as she typed it; "0" when the line is not in the request. */
  value: string;
  isInRequest: boolean;
  isDisabled: boolean;
  onStep: (delta: 1 | -1) => void;
  onChangeText: (text: string) => void;
  /** She left the number: an empty field or a zero takes the line out. */
  onBlur: () => void;
}

/**
 * − n + : a whole unit a tap, the number itself typed for anything else —
 * "1,5" as before. Every target is at least 48 dp for a gloved finger.
 */
export function QuantityStepper({
  name,
  value,
  isInRequest,
  isDisabled,
  onStep,
  onChangeText,
  onBlur,
}: QuantityStepperProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const face = useFontFace(COUNT_WEIGHT);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.stepper}>
      <StepButton
        glyph="−"
        label={t('supplies.decreaseAccessibility', { name })}
        isDisabled={isDisabled || !isInRequest}
        onPress={() => onStep(-1)}
        styles={styles}
      />
      <TextInput
        accessibilityLabel={t('supplies.quantityAccessibility', { name })}
        accessibilityState={{ disabled: isDisabled }}
        editable={!isDisabled}
        keyboardType="decimal-pad"
        selectTextOnFocus
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          onBlur();
        }}
        selectionColor={theme.primary}
        style={[
          styles.count,
          face,
          !isInRequest && styles.countIdle,
          isFocused && styles.countFocused,
        ]}
      />
      <StepButton
        glyph="+"
        label={t('supplies.increaseAccessibility', { name })}
        isDisabled={isDisabled}
        onPress={() => onStep(1)}
        styles={styles}
      />
    </View>
  );
}

interface StepButtonProps {
  glyph: string;
  label: string;
  isDisabled: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}

function StepButton({ glyph, label, isDisabled, onPress, styles }: StepButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        isDisabled && styles.stepDisabled,
        pressed && styles.stepPressed,
      ]}
    >
      <Text variant="title" tone={isDisabled ? 'muted' : 'primary'} align="center">
        {glyph}
      </Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    step: {
      minWidth: MIN_TOUCH_TARGET,
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDisabled: { backgroundColor: theme.surfaceAlt, borderColor: theme.divider },
    stepPressed: { backgroundColor: theme.surfaceAlt },
    // Drawn like a text field (components/text-field.tsx): she has to find
    // that the number is hers to type.
    count: {
      minWidth: COUNT_MIN_WIDTH,
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.xs,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: Radius.md,
      backgroundColor: theme.card,
      color: theme.text,
      fontSize: FontSize.title,
      textAlign: 'center',
    },
    countIdle: { color: theme.textSecondary },
    // Two pixels where one was: the state shows in the width as well as the colour.
    countFocused: { borderWidth: 2, borderColor: theme.focusRing },
  });
