import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { MediaStrip, type StripItem } from '@/features/media/media-strip';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import { formatReportedAt, problemPlace, problemPriorityText, problemStatusText } from './format';
import { MAX_PROBLEM_PHOTOS, type Problem } from './schema';

interface ProblemDetailProps {
  problem: Problem;
  photos: readonly StripItem[];
  /** True for the reporter while the report is open: she may still change it. */
  canEdit: boolean;
  onEdit: () => void;
  onCapture: () => void;
  onRemovePhoto: (mediaId: string) => void;
  onRetryPhoto: (mediaId: string) => void;
  isCapturing: boolean;
  /** The task that fixes it, when it is the reader's own. */
  fixTaskId: string | null;
  onOpenFixTask: (taskId: string) => void;
  error: Error | null;
  notice: string | null;
}

/**
 * One report, as it stands.
 *
 * Presentational: the route wires the camera and the queue in. Photos can be
 * added and taken back only while the report is open, the same rule the
 * server applies; afterwards the strip is a record.
 */
export function ProblemDetail({
  problem,
  photos,
  canEdit,
  onEdit,
  onCapture,
  onRemovePhoto,
  onRetryPhoto,
  isCapturing,
  fixTaskId,
  onOpenFixTask,
  error,
  notice,
}: ProblemDetailProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const failure = error === null ? null : serverErrorText(error);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{problem.title}</Text>
      <Text style={styles.meta}>
        {problemPlace(problem)} · {formatReportedAt(problem.created_at)}
      </Text>

      <View style={styles.facts}>
        <Fact
          label={t('problems.statusLabel')}
          value={problemStatusText(problem.status)}
          styles={styles}
        />
        <Fact
          label={t('problems.priorityLabel')}
          value={problemPriorityText(problem.priority)}
          styles={styles}
        />
        {problem.cancel_reason !== null ? (
          <Fact label={t('problems.cancelReason')} value={problem.cancel_reason} styles={styles} />
        ) : null}
      </View>

      {problem.description !== null ? (
        <View style={styles.block}>
          <Text style={styles.label}>{t('problems.descriptionLabel')}</Text>
          <Text style={styles.body}>{problem.description}</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.label}>{t('problems.photosLabel')}</Text>
        {photos.length === 0 && !canEdit ? (
          <Text style={styles.hint}>{t('problems.noPhotos')}</Text>
        ) : null}
        <MediaStrip
          items={photos}
          maxCount={MAX_PROBLEM_PHOTOS}
          onCapture={canEdit ? onCapture : undefined}
          onRemove={canEdit ? onRemovePhoto : undefined}
          onRetry={canEdit ? onRetryPhoto : undefined}
          isCapturing={isCapturing}
        />
      </View>

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

      {fixTaskId !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('problems.openFixTask')}
          onPress={() => onOpenFixTask(fixTaskId)}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>{t('problems.openFixTask')}</Text>
        </Pressable>
      ) : null}

      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('problems.edit')}
          onPress={onEdit}
          style={({ pressed }) => [styles.secondary, pressed && styles.buttonPressed]}
        >
          <Text style={styles.secondaryText}>{t('problems.edit')}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

interface FactProps {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}

function Fact({ label, value, styles }: FactProps) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.md },
    title: { color: theme.text, fontSize: FontSize.heading, fontWeight: '700' },
    meta: { color: theme.textSecondary, fontSize: FontSize.body },
    facts: {
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      padding: Spacing.lg,
      gap: Spacing.sm,
    },
    fact: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
    factLabel: { color: theme.textSecondary, fontSize: FontSize.body },
    factValue: {
      flex: 1,
      color: theme.text,
      fontSize: FontSize.body,
      fontWeight: '600',
      textAlign: 'right',
    },
    block: { gap: Spacing.xs },
    label: { color: theme.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
    body: { color: theme.text, fontSize: FontSize.body },
    hint: { color: theme.textSecondary, fontSize: FontSize.body },
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
    buttonPressed: { opacity: 0.75 },
    buttonText: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
    secondary: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: { color: theme.primary, fontSize: FontSize.title, fontWeight: '600' },
  });
