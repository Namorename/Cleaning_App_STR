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
import { MediaStrip, type StripItem } from '@/features/media/media-strip';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import {
  MAX_PROBLEM_DESCRIPTION,
  MAX_PROBLEM_PHOTOS,
  MAX_PROBLEM_TITLE,
  PROBLEM_PRIORITIES,
  problemDraftIssue,
  type ProblemDraft,
  type ProblemPriority,
} from './schema';

interface ProblemFormProps {
  draft: ProblemDraft;
  onChange: (draft: ProblemDraft) => void;
  /** Where it is, when known; the form does not let her change it. */
  place: string | null;
  /** Absent when the form edits an existing report: photos live on its screen. */
  photos?: readonly StripItem[];
  onCapture?: () => void;
  onRemovePhoto?: (mediaId: string) => void;
  isCapturing?: boolean;
  isSubmitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
  /** The last attempt's failure, shown next to the button so she can retry. */
  error: Error | null;
  notice?: string | null;
}

/**
 * What is broken, in her words.
 *
 * Presentational: the route wires the camera and the queue in. The title is
 * the one thing the server insists on; the button stays grey until it is
 * there, mirroring the refusal rather than sending it to be refused.
 */
export function ProblemForm({
  draft,
  onChange,
  place,
  photos,
  onCapture,
  onRemovePhoto,
  isCapturing = false,
  isSubmitting,
  submitLabel,
  onSubmit,
  error,
  notice = null,
}: ProblemFormProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const issue = problemDraftIssue(draft);
  const canSubmit = issue === null && !isSubmitting;
  const failure = error === null ? null : serverErrorText(error);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {place !== null ? <Text style={styles.place}>{place}</Text> : null}

      <View style={styles.field}>
        <Text style={styles.label}>{t('problems.titleLabel')}</Text>
        <TextInput
          accessibilityLabel={t('problems.titleLabel')}
          editable={!isSubmitting}
          maxLength={MAX_PROBLEM_TITLE}
          onChangeText={(title) => onChange({ ...draft, title })}
          placeholder={t('problems.titlePlaceholder')}
          placeholderTextColor={styles.counter.color}
          style={styles.input}
          value={draft.title}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t('problems.descriptionLabel')}</Text>
        <TextInput
          accessibilityLabel={t('problems.descriptionLabel')}
          editable={!isSubmitting}
          maxLength={MAX_PROBLEM_DESCRIPTION}
          multiline
          onChangeText={(description) => onChange({ ...draft, description })}
          placeholder={t('problems.descriptionPlaceholder')}
          placeholderTextColor={styles.counter.color}
          style={[styles.input, styles.inputMultiline]}
          textAlignVertical="top"
          value={draft.description}
        />
        <Text style={styles.counter}>
          {draft.description.length} / {MAX_PROBLEM_DESCRIPTION}
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t('problems.priorityLabel')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {PROBLEM_PRIORITIES.map((priority) => (
            <PriorityChip
              key={priority}
              priority={priority}
              selected={draft.priority === priority}
              disabled={isSubmitting}
              onSelect={() => onChange({ ...draft, priority })}
              styles={styles}
            />
          ))}
        </View>
      </View>

      {photos !== undefined ? (
        <View style={styles.field}>
          <Text style={styles.label}>{t('problems.photosLabel')}</Text>
          <Text style={styles.hint}>{t('problems.photosHint', { max: MAX_PROBLEM_PHOTOS })}</Text>
          <MediaStrip
            items={photos}
            maxCount={MAX_PROBLEM_PHOTOS}
            onCapture={onCapture}
            onRemove={onRemovePhoto}
            isCapturing={isCapturing}
            disabled={isSubmitting}
          />
        </View>
      ) : null}

      {notice !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {notice}
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

interface PriorityChipProps {
  priority: ProblemPriority;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  styles: ReturnType<typeof createStyles>;
}

function PriorityChip({ priority, selected, disabled, onSelect, styles }: PriorityChipProps) {
  const { t } = useTranslation();
  const label = t(`problems.priorities.${priority}`);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const INPUT_MIN_HEIGHT = 120;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.lg },
    place: { color: theme.textSecondary, fontSize: FontSize.body },
    field: { gap: Spacing.xs },
    label: { color: theme.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
    hint: { color: theme.textSecondary, fontSize: FontSize.body },
    input: {
      minHeight: MIN_TOUCH_TARGET,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      fontSize: FontSize.title,
      color: theme.text,
      backgroundColor: theme.card,
    },
    inputMultiline: { minHeight: INPUT_MIN_HEIGHT },
    counter: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'right' },
    chips: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
    chip: {
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.card,
      justifyContent: 'center',
    },
    chipSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
    chipText: { color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    chipTextSelected: { color: theme.onPrimary },
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
  });
