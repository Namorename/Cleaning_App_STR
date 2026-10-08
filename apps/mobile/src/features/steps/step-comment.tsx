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

/** Free text from the cleaner: what the office should know about this flat today. */
export function StepComment({ value, onChangeText, disabled }: StepCommentProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.field}>
      <TextField
        label={t('steps.types.cleaner_comment')}
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
