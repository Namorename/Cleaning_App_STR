import { STATUS_TONE, type Json } from '@str-ops/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { FailureText } from '@/components/failure-text';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { BUTTON_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
import {
  canCompleteMediaStep,
  mediaKindOfStep,
  photoLimits,
  type MediaItemView,
} from '@/features/media/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { wordContext } from '@/i18n';

import { STEP_STATUS_KEY, stepInstructions, stepStatusLine, stepTitle } from './format';
import {
  checkedItemIds,
  checkedLines,
  checklistModules,
  commentText,
  noteLines,
  remainingChecklistItems,
  stepState,
  type TaskStep,
} from './schema';
import { StepChecklist } from './step-checklist';
import { StepComment } from './step-comment';
import { StepMedia } from './step-media';
import { StepTaskNote } from './step-task-note';

const noop = () => undefined;

interface StepScreenProps {
  step: TaskStep;
  /** Her own task, still in progress. Otherwise the step is read-only. */
  isEditable: boolean;
  isBusy: boolean;
  error: Error | null;
  /** A sentence already in her language — the camera refused, say. */
  notice?: string | null;
  onComplete: (payload: Json) => void;
  onReopen: () => void;
  onSkip: () => void;
  /** The photos or video of a media step, and what can be done with them. */
  media?: readonly MediaItemView[];
  /**
   * A video step's length, worked out by the route from the company and the
   * step (`videoLimits`); null while the company's settings are unknown.
   */
  maxVideoSec?: number | null;
  isCapturing?: boolean;
  /** Only when the company allows it — `hosts.gallery_allowed`. */
  canPickFromGallery?: boolean;
  onCapture?: () => void;
  onPickFromGallery?: () => void;
  onRemoveMedia?: (mediaId: string) => void;
  onRetryMedia?: (mediaId: string) => void;
}

/**
 * One step, and what the cleaner can do with it.
 *
 * Presentational: the route wires the hooks in and decides what happens after
 * a tap. The body depends on the type; the actions depend on the state — a
 * pending step is completed (or skipped, if optional), a done or skipped one
 * can be taken back, a waived one is left as the manager left it, and a step
 * of a type this build does not know explains itself.
 *
 * The owner kept this screen's layout (decisions §2, «Уборка и шаги»): «Готово»
 * stays at the end and takes her back to the task; only the look is new.
 */
export function StepScreen({
  step,
  isEditable,
  isBusy,
  error,
  notice = null,
  onComplete,
  onReopen,
  onSkip,
  media = [],
  maxVideoSec = null,
  isCapturing = false,
  canPickFromGallery = false,
  onCapture = noop,
  onPickFromGallery = noop,
  onRemoveMedia = noop,
  onRetryMedia = noop,
}: StepScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const state = stepState(step);
  const instructions = stepInstructions(step);
  const lines = noteLines(instructions);
  const [checked, setChecked] = useState<number[]>(() => checkedLines(step));
  const [comment, setComment] = useState(() => commentText(step));
  const modules = useMemo(() => checklistModules(step), [step]);
  const [checkedItems, setCheckedItems] = useState<string[]>(() => checkedItemIds(step));
  const mediaKind = mediaKindOfStep(step.type);
  const limits = photoLimits(step);

  // Ticks that no longer match an item — the checklist changed under a queued
  // answer — count for nothing, here as on the server.
  const progress = useMemo(() => {
    const items = modules.flatMap((checklistModule) => checklistModule.items);
    return {
      done: items.filter((item) => checkedItems.includes(item.id)).length,
      total: items.length,
    };
  }, [modules, checkedItems]);

  const isPending = state === 'pending';
  const canAct = isEditable && !isBusy;
  const canComplete =
    canAct &&
    isPending &&
    (step.type === 'confirmation' ||
      (step.type === 'task_note' && lines.every((_, index) => checked.includes(index))) ||
      (step.type === 'cleaner_comment' && comment.trim() !== '') ||
      (step.type === 'checklist' && remainingChecklistItems(modules, checkedItems) === 0) ||
      (mediaKind !== null && canCompleteMediaStep(mediaKind, media, limits)));

  const toggleLine = (index: number) => {
    setChecked((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );
  };

  const toggleItem = (itemId: string) => {
    setCheckedItems((current) =>
      current.includes(itemId) ? current.filter((item) => item !== itemId) : [...current, itemId],
    );
  };

  const complete = () => {
    if (!canComplete) {
      return;
    }
    if (step.type === 'task_note') {
      onComplete({ checked_lines: [...checked].sort((a, b) => a - b) });
    } else if (step.type === 'cleaner_comment') {
      onComplete({ text: comment.trim() });
    } else if (step.type === 'checklist') {
      onComplete({ checked_item_ids: [...checkedItems].sort() });
    } else {
      onComplete({});
    }
  };

  const statusLine = stepStatusLine(step);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={layout.content}>
      <View style={layout.header}>
        <Text variant="heading">{stepTitle(step)}</Text>
        {step.required ? (
          // A fact about the step, not an alarm: neutral, where it used to be red.
          <Badge
            testID="step-required"
            label={t('steps.required')}
            tone={STATUS_TONE['steps.required']}
          />
        ) : null}
      </View>

      {statusLine !== null ? (
        // Where the step stands, in its tone: done green, skipped or waived grey.
        <Badge testID="step-status" label={statusLine} tone={STATUS_TONE[STEP_STATUS_KEY[state]]} />
      ) : null}

      {state === 'unsupported' ? (
        <Text tone="secondary">{t('steps.unsupported')}</Text>
      ) : step.type === 'task_note' ? (
        <>
          <Text tone="secondary">{t('steps.noteHint')}</Text>
          <StepTaskNote
            lines={lines}
            checked={checked}
            onToggle={toggleLine}
            disabled={!canAct || !isPending}
          />
        </>
      ) : step.type === 'cleaner_comment' ? (
        <StepComment value={comment} onChangeText={setComment} disabled={!canAct || !isPending} />
      ) : step.type === 'checklist' ? (
        <>
          <Text tone="secondary">{t('steps.checklistHint')}</Text>
          <Text>{t('steps.checklistProgress', progress)}</Text>
          <StepChecklist
            modules={modules}
            checked={checkedItems}
            onToggle={toggleItem}
            disabled={!canAct || !isPending}
          />
        </>
      ) : mediaKind !== null ? (
        <>
          {instructions !== null ? <Instructions text={instructions} /> : null}
          <StepMedia
            kind={mediaKind}
            items={media}
            limits={limits}
            maxVideoSec={maxVideoSec}
            isCapturing={isCapturing}
            disabled={!canAct || !isPending}
            canPickFromGallery={canPickFromGallery}
            onCapture={onCapture}
            onPickFromGallery={onPickFromGallery}
            onRemove={onRemoveMedia}
            onRetry={onRetryMedia}
          />
        </>
      ) : instructions !== null ? (
        <Instructions text={instructions} />
      ) : null}

      {notice !== null ? (
        <Text accessibilityLiveRegion="polite" tone="danger" align="center">
          {notice}
        </Text>
      ) : null}

      {error !== null ? <FailureText error={error} /> : null}

      {!isEditable ? (
        <Text tone="secondary">{t('steps.readOnly', { context: wordContext() })}</Text>
      ) : null}

      {isEditable && isPending ? (
        // Its own move in flight spins it; until the step is complete it waits.
        <Button
          label={step.type === 'cleaner_comment' ? t('steps.save') : t('steps.done')}
          isBusy={isBusy}
          isDisabled={!canComplete && !isBusy}
          onPress={complete}
        />
      ) : null}

      {isEditable && (isPending || state === 'unsupported') && !step.required ? (
        <Button variant="outline" label={t('steps.skip')} isDisabled={!canAct} onPress={onSkip} />
      ) : null}

      {isEditable && (state === 'done' || state === 'skipped') ? (
        <Button
          variant="outline"
          label={t('steps.reopen')}
          isBusy={isBusy}
          isDisabled={!canAct && !isBusy}
          onPress={onReopen}
        />
      ) : null}
    </ScrollView>
  );
}

interface InstructionsProps {
  text: string;
}

/** The manager's wording, one line under another, large enough to read at the door. */
function Instructions({ text }: InstructionsProps) {
  return (
    <Card>
      {noteLines(text).map((line, index) => (
        <Text key={`${index}-${line}`} variant="title" weight={600}>
          {line}
        </Text>
      ))}
    </Card>
  );
}

/** The skeleton's blocks: the step's name, a line, the body's card. */
const SKELETON_HEADING = 28;
const SKELETON_LINE = 16;
const SKELETON_CARD = 160;

interface StepScreenSkeletonProps {
  /** What is loading, said to the reader. */
  label: string;
}

/** The shape of a step while it loads: its name, a line, its body, the button. */
export function StepScreenSkeleton({ label }: StepScreenSkeletonProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.screen}>
      <SkeletonGroup label={label} style={layout.content}>
        <Skeleton height={SKELETON_HEADING} width="60%" />
        <Skeleton height={SKELETON_LINE} width="80%" />
        <Skeleton height={SKELETON_CARD} radius={Radius.card} />
        <Skeleton height={BUTTON_HEIGHT} radius={Radius.pill} />
      </SkeletonGroup>
    </View>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  header: { gap: Spacing.xs },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
