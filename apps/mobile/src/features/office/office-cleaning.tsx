import { STATUS_TONE, cleaningClosingLines, taskStatusTone } from '@str-ops/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { useScreenEdgePadding } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorBanner } from '@/components/error-banner';
import { FailureText } from '@/components/failure-text';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { MIN_TOUCH_TARGET, Spacing, type Theme } from '@/constants/theme';
import { Nobody } from '@/features/board/board-card';
import type { TaskStep } from '@/features/steps/schema';
import { StepList } from '@/features/steps/step-list';
import {
  formatClockTime,
  formatScheduledDate,
  formatWindow,
  jobWordKey,
  taskPlace,
  urgencyText,
} from '@/features/tasks/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { assigneeText, kindText, offLines, officeStatusText } from './format';
import { canAssignCleaning, canRestoreCleaning, type OfficeTask } from './schema';

interface OfficeCleaningProps {
  task: OfficeTask;
  /** The job's steps; undefined while they load. */
  steps?: readonly TaskStep[];
  /** A move of the office is on its way: the buttons hold. */
  isBusy: boolean;
  /** The card was read from the server since it opened: the moves wait for that. */
  isCurrent: boolean;
  /** The last move's failure — an assignment or a return; a cancel says its own on its sheet. */
  error: Error | null;
  /** A refresh that failed over the card still on screen. */
  refreshError?: Error | null;
  /** «Отменить уборку» is the office's to offer (`cleaningOffs`). */
  canCancel: boolean;
  onAssign: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onOpenStep: (stepId: string) => void;
  onOpenProblem: (problemId: string) => void;
  onOpenChat: (taskId: string) => void;
  /** The place's instructions from the knowledge base, under its notes. */
  instructions?: ReactNode;
}

/**
 * A cleaning on the office's phone (owner, 2026-11-18): what it is, where and
 * when, who is on it — or that nobody is — and, taken off, who took it off and
 * why; its notes, and its steps with their photos, read-only, in whatever
 * status they exist. What the office does with it: put somebody on it or
 * somebody else, cancel it, or return one it cancelled. Never the cleaner's
 * moves — no take, accept, start or finish: those are the person's at the door.
 *
 * Presentational: the screen wires the hooks and the sheets in.
 */
export function OfficeCleaning({
  task,
  steps,
  isBusy,
  isCurrent,
  error,
  refreshError = null,
  canCancel,
  onAssign,
  onCancel,
  onRestore,
  onOpenStep,
  onOpenProblem,
  onOpenChat,
  instructions,
}: OfficeCleaningProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const end = useScreenEdgePadding(Spacing.lg);
  const place = taskPlace(task);
  const address = place.address === null || place.address.trim() === '' ? null : place.address;
  const window = formatWindow(task);
  const offs = offLines(task, t);
  const placeNotes = task.property?.effective_cleaner_notes?.trim() ?? '';
  const taskNote = task.notes?.trim() ?? '';
  const fix = task.type === 'maintenance' ? (task.problem ?? null) : null;
  const isRepair = task.problem_id !== null && task.problem_id !== undefined;
  const hasSteps = steps !== undefined && steps.length > 0;
  const canAssign = canAssignCleaning(task);
  const canRestore = canRestoreCleaning(task);
  const isHeld = isBusy || !isCurrent;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[layout.content, end]}>
      {refreshError !== null ? (
        <ErrorBanner title={t('common.refreshFailedSaved')} error={refreshError} />
      ) : null}

      <View style={layout.place}>
        <Text variant="heading">{place.building}</Text>
        {place.room === null ? null : (
          <Text variant="title" tone="secondary">
            {place.room}
          </Text>
        )}
        {address === null ? null : <Text tone="secondary">{address}</Text>}
      </View>
      <Text tone="secondary">{formatScheduledDate(task)}</Text>

      <View style={layout.flags}>
        <Badge
          testID="office-status"
          label={officeStatusText(task.status, t)}
          tone={taskStatusTone(task.status)}
        />
        <Badge label={urgencyText(task)} tone={STATUS_TONE['phone.kindBanner']} />
      </View>

      <Card testID="office-facts">
        <Fact label={t('office.cleaning.kind')}>
          <Text style={layout.value}>{kindText(task, t)}</Text>
        </Fact>
        {window === null ? null : (
          <Fact label={t(jobWordKey(task.type, 'window'))}>
            <Text style={layout.value}>{window}</Text>
          </Fact>
        )}
        <Fact label={t('office.cleaning.assignee')}>
          {task.assignee_id === null ? (
            <Nobody label={t('office.cleanings.nobody')} />
          ) : (
            <Text style={layout.value}>{assigneeText(task, t)}</Text>
          )}
        </Fact>
        {task.guests_count === null ? null : (
          <Fact label={t('tasks.detail.guests')}>
            <Text style={layout.value}>{String(task.guests_count)}</Text>
          </Fact>
        )}
        {task.started_at === null ? null : (
          <Fact label={t('tasks.detail.startedAt')}>
            <Text style={layout.value}>{formatClockTime(task.started_at)}</Text>
          </Fact>
        )}
        {task.completed_at === null ? null : (
          <Fact label={t('tasks.detail.completedAt')}>
            <Text style={layout.value}>{formatClockTime(task.completed_at)}</Text>
          </Fact>
        )}
      </Card>

      {/* Who took it off and why: the mark first, strongly on work waiting for a person. */}
      {offs.length > 0 ? (
        <View testID="office-offs" style={layout.offs}>
          {offs.map((line, index) => (
            <Text key={line} weight={index === 0 && task.status === 'unassigned' ? 700 : undefined}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {/* Who did it and who closed it (20261106125500): a cleaning's own, not a repair's. */}
      {fix === null && task.closing != null
        ? cleaningClosingLines(task.status, task.closing, t).map((line) => (
            <Text key={line.text} tone="secondary">
              {line.note === null ? line.text : `${line.text} (${line.note})`}
            </Text>
          ))
        : null}

      {fix !== null ? (
        <Card
          accessibilityLabel={`${fix.title}. ${t('tasks.detail.openProblem')}`}
          onPress={() => onOpenProblem(fix.id)}
          style={layout.target}
        >
          <Text variant="caption" tone="secondary" weight={700}>
            {t('tasks.detail.problem')}
          </Text>
          <Text>{fix.title}</Text>
          <Text tone="secondary">{t('tasks.detail.openProblem')}</Text>
        </Card>
      ) : null}

      {placeNotes !== '' ? <NoteCard label={t('tasks.detail.notes')} text={placeNotes} /> : null}
      {instructions}
      {taskNote !== '' ? <NoteCard label={t('office.cleaning.note')} text={taskNote} /> : null}

      <Button
        variant="outline"
        label={t('tasks.detail.openChat')}
        left={<Icon name="action.openChat" tone="primary" />}
        onPress={() => onOpenChat(task.id)}
      />

      {hasSteps ? (
        <StepList
          steps={steps}
          heading={t(jobWordKey(task.type, 'steps'))}
          onOpenStep={onOpenStep}
        />
      ) : null}

      {error !== null ? <FailureText error={error} /> : null}

      {isRepair ? <Text tone="secondary">{t('office.cleaning.repair')}</Text> : null}

      {canAssign ? (
        <Button
          variant={task.assignee_id === null ? 'primary' : 'outline'}
          label={t(task.assignee_id === null ? 'office.cleaning.assign' : 'office.cleaning.reassign')}
          isDisabled={isHeld}
          onPress={onAssign}
        />
      ) : null}
      {canRestore ? (
        <Button label={t('office.cleaning.restore')} isDisabled={isHeld} onPress={onRestore} />
      ) : null}
      {canCancel ? (
        <Button
          variant="destructive"
          label={t('tasks.offs.cancel')}
          isDisabled={isHeld}
          onPress={onCancel}
        />
      ) : null}
    </ScrollView>
  );
}

interface FactProps {
  label: string;
  children: ReactNode;
}

/** A fact and its value on one line; at a large font the value wraps under it. */
function Fact({ label, children }: FactProps) {
  return (
    <View style={layout.fact}>
      <Text tone="secondary" style={layout.value}>
        {label}
      </Text>
      {children}
    </View>
  );
}

interface NoteCardProps {
  label: string;
  text: string;
}

function NoteCard({ label, text }: NoteCardProps) {
  return (
    <Card>
      <Text variant="caption" tone="secondary" weight={700}>
        {label}
      </Text>
      <Text>{text}</Text>
    </Card>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  place: { gap: Spacing.xs },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  fact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: Spacing.md,
    rowGap: Spacing.xs,
  },
  value: { flexShrink: 1 },
  offs: { gap: Spacing.xs },
  target: { minHeight: MIN_TOUCH_TARGET },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
