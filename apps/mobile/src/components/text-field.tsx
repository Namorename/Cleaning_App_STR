import { useId, useState, type Ref } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { BUTTON_HEIGHT, FontSize, Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { Text, useFontFace } from './text';

type FocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type BlurEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];

/** The weight of what she types: the body weight. */
const INPUT_WEIGHT = 600;

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'editable'> {
  /** Shown above the field, and its name for a screen reader. */
  label: string;
  /** One line under the field saying what goes in it; gives way to an error. */
  hint?: string;
  /** What is wrong with what she typed, in her language. */
  error?: string | null;
  isDisabled?: boolean;
  /** Layout of the whole field — a margin, a flex. */
  style?: StyleProp<ViewStyle>;
  ref?: Ref<TextInput>;
}

/**
 * A text field: its label above, a hint or an error below. 56 dp high like a
 * button, so a gloved finger finds it; the outline is `border` (≥ 3:1 on every
 * surface), the focus ring when she is in it, `danger` when it is wrong — the
 * error is said in words as well, never by the colour alone.
 */
export function TextField({
  label,
  hint,
  error = null,
  isDisabled = false,
  style,
  onFocus,
  onBlur,
  ref,
  ...input
}: TextFieldProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const face = useFontFace(INPUT_WEIGHT);
  const labelId = useId();
  const [isFocused, setIsFocused] = useState(false);
  const hasError = error !== null && error !== '';

  const handleFocus = (event: FocusEvent) => {
    setIsFocused(true);
    onFocus?.(event);
  };
  const handleBlur = (event: BlurEvent) => {
    setIsFocused(false);
    onBlur?.(event);
  };

  return (
    <View style={[styles.field, style]}>
      <Text nativeID={labelId} tone="secondary">
        {label}
      </Text>
      <TextInput
        {...input}
        ref={ref}
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        accessibilityHint={hint}
        accessibilityState={{ disabled: isDisabled }}
        editable={!isDisabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholderTextColor={theme.textMuted}
        selectionColor={theme.primary}
        style={[
          styles.input,
          face,
          isFocused && styles.focused,
          hasError && styles.invalid,
          isDisabled && styles.disabled,
        ]}
      />
      {hasError ? (
        <Text
          variant="caption"
          tone="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : hint !== undefined ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    field: { gap: Spacing.xs },
    input: {
      minHeight: BUTTON_HEIGHT,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.body,
      color: theme.text,
      backgroundColor: theme.card,
    },
    // Two pixels where one was: the state shows in the width as well as the colour.
    focused: { borderWidth: 2, borderColor: theme.focusRing },
    invalid: { borderWidth: 2, borderColor: theme.danger },
    disabled: { backgroundColor: theme.surfaceAlt, color: theme.textMuted },
  });
