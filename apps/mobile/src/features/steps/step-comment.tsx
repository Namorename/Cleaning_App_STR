import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Spacing } from '@/constants/theme';

import { MAX_COMMENT_LENGTH } from './schema';

interface StepCommentProps {
  value: string;
  onChangeText: (value: string) => void;
  disabled: boolean;
}

/**
 * Free text from the cleaner: what the office should know about this flat today.
 *
 * The field's label says who reads it, not «Комментарий» again: the step's
 * heading right above already names it. What she types is `TextField`'s body
 * size, like every other field.
 */
export function StepComment({ value, onChangeText, disabled }: StepCommentProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.field}>
      <TextField
        label={t('steps.commentLabel')}
        isDisabled={disabled}
        maxLength={MAX_COMMENT_LENGTH}
        multiline
        onChangeText={onChangeText}
        placeholder={t('steps.commentPlaceholder')}
        value={value}
      />
      <Text variant="caption" tone="secondary" align="right">
        {value.length} / {MAX_COMMENT_LENGTH}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.xs },
});
