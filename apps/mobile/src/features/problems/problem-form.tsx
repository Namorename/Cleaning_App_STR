import { HeaderHeightContext } from 'expo-router/react-navigation';
import { use } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ActionBar } from '@/components/action-bar';
import { useKeyboardOffset } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { MediaStrip, type StripItem } from '@/features/media/media-strip';
import { PropertyPicker } from '@/features/properties/property-picker';
import type { ReportProperty } from '@/features/properties/schema';
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
  /** Where it is, when the report came from a task and cannot be moved. */
  place: string | null;
  /**
   * The places she may report about, when she is the one choosing.
   *
   * Absent from a report filed on a task: the task already says where it is,
   * and offering a choice would invite a report about the wrong flat.
   */
  properties?: readonly ReportProperty[];
  selectedPropertyId?: number | null;
  onSelectProperty?: (propertyId: number) => void;
  isLoadingProperties?: boolean;
  /** Absent when the form edits an existing report: photos live on its screen. */
  photos?: readonly StripItem[];
  onCapture?: () => void;
  onPickFromGallery?: () => void;
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
 * The owner's variant 1 (docs/design/decisions.md §2): filled from the top
 * down with one hand — the photos first, then where, then what happened and
 * the details — and the button pinned under the form instead of at the end of
 * it, riding above the keyboard while she types.
 *
 * Presentational: the route wires the camera and the queue in. The title is
 * the one thing the server insists on; the button stays grey until it is
 * there, mirroring the refusal rather than sending it to be refused.
 */
export function ProblemForm({
  draft,
  onChange,
  place,
  properties,
  selectedPropertyId = null,
  onSelectProperty,
  isLoadingProperties = false,
  photos,
  onCapture,
  onPickFromGallery,
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
  // The keyboard's top is measured from the window's, the form's from under
  // the header: the header's height is the difference. Outside a navigator
  // (a test) there is no header. Less the inset the action bar rises by
  // (components/bottom-inset.ts).
  const keyboardOffset = useKeyboardOffset(use(HeaderHeightContext) ?? 0);
  const failure = error === null ? null : serverErrorText(error);

  return (
    // Padding on both systems: the view measures how much of it the keyboard
    // covers, so it adds nothing where the system has already made room, and
    // with Android drawing edge to edge the system does not.
    <KeyboardAvoidingView
      style={styles.screen}
      behavior="padding"
      keyboardVerticalOffset={keyboardOffset}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {photos !== undefined ? (
          <View style={styles.field}>
            <Text tone="secondary">{t('problems.photosLabel')}</Text>
            <Text variant="caption" tone="secondary">
              {t('problems.photosHint', { max: MAX_PROBLEM_PHOTOS })}
            </Text>
            <MediaStrip
              items={photos}
              maxCount={MAX_PROBLEM_PHOTOS}
              onCapture={onCapture}
              onPickFromGallery={onPickFromGallery}
              onRemove={onRemovePhoto}
              isCapturing={isCapturing}
              disabled={isSubmitting}
            />
          </View>
        ) : null}

        {notice !== null ? (
          <Text accessibilityLiveRegion="polite" tone="secondary">
            {notice}
          </Text>
        ) : null}

        {onSelectProperty !== undefined ? (
          <PropertyPicker
            properties={properties ?? []}
            selectedId={selectedPropertyId}
            onSelect={onSelectProperty}
            isLoading={isLoadingProperties}
          />
        ) : place !== null ? (
          <View style={styles.field}>
            <Text tone="secondary">{t('problems.place')}</Text>
            <Text>{place}</Text>
          </View>
        ) : null}

        <TextField
          label={t('problems.titleLabel')}
          isDisabled={isSubmitting}
          maxLength={MAX_PROBLEM_TITLE}
          onChangeText={(title) => onChange({ ...draft, title })}
          placeholder={t('problems.titlePlaceholder')}
          value={draft.title}
        />

        <View style={styles.field}>
          <TextField
            label={t('problems.descriptionLabel')}
            isDisabled={isSubmitting}
            maxLength={MAX_PROBLEM_DESCRIPTION}
            multiline
            onChangeText={(description) => onChange({ ...draft, description })}
            placeholder={t('problems.descriptionPlaceholder')}
            value={draft.description}
          />
          <Text variant="caption" tone="secondary" align="right">
            {draft.description.length} / {MAX_PROBLEM_DESCRIPTION}
          </Text>
        </View>

        <View style={styles.field}>
          <Text tone="secondary">{t('problems.priorityLabel')}</Text>
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
      </ScrollView>

      <ActionBar isAtScreenEdge testID="problem-form-actions">
        {failure !== null ? (
          <View accessibilityLiveRegion="polite" style={styles.failure}>
            <Text tone="danger" align="center">
              {failure.text}
            </Text>
            {failure.detail !== null ? (
              // The server's words, for passing on; a long one must not push
              // the button off the screen.
              <Text variant="caption" tone="secondary" align="center" numberOfLines={3}>
                {failure.detail}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Button
          label={submitLabel}
          onPress={onSubmit}
          isDisabled={problemDraftIssue(draft) !== null}
          isBusy={isSubmitting}
        />
      </ActionBar>
    </KeyboardAvoidingView>
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
      <Text weight={600} tone={selected ? 'onPrimary' : 'default'}>
        {label}
      </Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.lg },
    field: { gap: Spacing.xs },
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
    failure: { gap: Spacing.xs },
  });
