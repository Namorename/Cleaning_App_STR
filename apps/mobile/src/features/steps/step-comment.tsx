import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FontSize, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { MAX_COMMENT_LENGTH } from './schema';

interface StepCommentProps {
  value: string;
  onChangeText: (value: string) => void;
  disabled: boolean;
}

/** Free text from the cleaner: what the office should know about this flat today. */
export function StepComment({ value, onChangeText, disabled }: StepCommentProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.field}>
      <TextInput
        accessibilityLabel={t('steps.types.cleaner_comment')}
        editable={!disabled}
        maxLength={MAX_COMMENT_LENGTH}
        multiline
        onChangeText={onChangeText}
        placeholder={t('steps.commentPlaceholder')}
        placeholderTextColor={styles.counter.color}
        style={[styles.input, disabled && styles.inputDisabled]}
        textAlignVertical="top"
        value={value}
      />
      <Text style={styles.counter}>
        {value.length} / {MAX_COMMENT_LENGTH}
      </Text>
    </View>
  );
}

const INPUT_MIN_HEIGHT = 140;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    field: { gap: Spacing.xs },
    input: {
      minHeight: INPUT_MIN_HEIGHT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      fontSize: FontSize.title,
      color: theme.text,
      backgroundColor: theme.card,
    },
    inputDisabled: { opacity: 0.7 },
    counter: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'right' },
  });
