import { ADDITION_MAX_FILES } from '@str-ops/shared';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { useScreenEdgePadding } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Spacing, type Theme } from '@/constants/theme';
import { personName, staffNames } from '@/features/board/format';
import { useStaffDirectory } from '@/features/board/use-board';
import { useProblemAction } from '@/features/office/use-office';
import { OfficeFilesEditor } from '@/features/problems/office-files-editor';
import { endFlow, officeFlow, uploadPicks, useOfficeFlow } from '@/features/problems/office-picks';
import { usePublishOfficeMedia } from '@/features/problems/use-additions';
import { useThemedStyles } from '@/hooks/use-themed-styles';

// A screen that cannot draw says so, with «Повторить» and «Назад», and is reported.
export { RouteError as ErrorBoundary } from '@/components/route-error';

/** The longest comment: a message of the task's chat (chat_body_max_length). */
const COMMENT_MAX_LENGTH = 4000;

const Params = z.object({
  id: z.string().uuid(),
  // 'open': files for a task at work; 'closing': the closing's files and words.
  mode: z.enum(['open', 'closing']).default('open'),
  // Who did the work, from the closing's sheet: a person's id, or «alone».
  who: z.string().optional(),
  comment: z.string().optional(),
});

/**
 * The office's photos and videos for a task (owner, 2026-11-26), and — opened from «Отметить
 * выполненным» — the closing that takes them with the comment. The files go first, one by one;
 * a file that failed keeps the screen with its reason: «Повторить», or go on without it by the
 * manager's choice. Leaving the screen gives the files up.
 */
export default function OfficeFilesRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const end = useScreenEdgePadding(Spacing.lg);
  const parsed = Params.safeParse(useLocalSearchParams());
  const problemId = parsed.success ? parsed.data.id : '';
  const mode = parsed.success ? parsed.data.mode : 'open';
  const who = parsed.success && parsed.data.who !== 'alone' ? (parsed.data.who ?? null) : null;

  const flow = useOfficeFlow(problemId);
  const publish = usePublishOfficeMedia(problemId);
  const resolve = useProblemAction();
  const staff = useStaffDirectory();
  const names = useMemo(() => staffNames(staff.data, t), [staff.data, t]);
  const [comment, setComment] = useState(parsed.success ? (parsed.data.comment ?? '') : '');
  const [commentId] = useState(() => randomUUID());
  const [isSending, setSending] = useState(false);

  // The files are given up with the screen: added, closed with, or left.
  useEffect(() => () => endFlow(problemId), [problemId]);

  const failedCount = flow.picks.filter((pick) => pick.status === 'failed').length;
  const doneCount = flow.picks.filter((pick) => pick.status === 'done').length;
  const isBusy = isSending || publish.isPending || resolve.isPending;
  const hasFailed = failedCount > 0 && !isBusy;
  const words = comment.trim();

  const leave = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  /** Show the batch (at work), or close with it (at the closing). */
  const finish = (arrived: number) => {
    const { additionId } = officeFlow(problemId);
    if (mode === 'open') {
      publish.mutate(additionId, { onSuccess: leave });
      return;
    }
    resolve.mutate(
      {
        kind: 'resolve',
        problemId,
        completedBy: who,
        closing:
          arrived === 0 && words === ''
            ? null
            : { additionId, comment: words === '' ? null : words, commentId },
      },
      { onSuccess: leave },
    );
  };

  const send = async () => {
    setSending(true);
    try {
      const outcome = await uploadPicks(problemId);
      if (outcome.failed === 0) {
        finish(outcome.done);
      }
    } finally {
      setSending(false);
    }
  };

  const failure = publish.error ?? resolve.error ?? null;
  const confirmLabel =
    mode === 'open' ? t('problems.additions.send') : t('office.problem.resolveConfirm');
  const withoutLabel =
    mode === 'open' ? t('problems.additions.addWithout') : t('problems.additions.closeWithout');
  const canSend = !isBusy && (mode === 'closing' || flow.picks.length > 0);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[layout.content, end]}
      keyboardShouldPersistTaps="handled"
    >
      {mode === 'closing' ? (
        <>
          <Text tone="secondary">
            {`${t('office.problem.who')}: ${who === null ? t('office.problem.alone') : personName(names, who)}`}
          </Text>
          <TextField
            label={t('problems.additions.comment')}
            isDisabled={isBusy}
            maxLength={COMMENT_MAX_LENGTH}
            multiline
            onChangeText={setComment}
            value={comment}
          />
          <Text variant="caption" tone="secondary">
            {t('problems.additions.commentHint')}
          </Text>
          <Text weight={700}>{t('problems.additions.files')}</Text>
        </>
      ) : (
        <Text tone="secondary">
          {t('problems.additions.dialogText', { limit: ADDITION_MAX_FILES })}
        </Text>
      )}

      <OfficeFilesEditor problemId={problemId} isLocked={isBusy} />

      {isSending ? (
        <Text accessibilityLiveRegion="polite" tone="secondary">
          {t('problems.additions.sending', { done: doneCount, total: flow.picks.length })}
        </Text>
      ) : null}
      {failure !== null ? <FailureText error={failure} /> : null}

      <View style={layout.buttons}>
        <Button
          label={hasFailed ? t('problems.additions.retry') : confirmLabel}
          isBusy={isBusy}
          isDisabled={!canSend}
          onPress={() => void send()}
        />
        {hasFailed && (mode === 'closing' || doneCount > 0) ? (
          <Button
            variant="outline"
            label={withoutLabel}
            isDisabled={isBusy}
            onPress={() => finish(doneCount)}
          />
        ) : null}
        <Button
          variant="outline"
          label={t('problems.additions.cancel')}
          isDisabled={isBusy}
          onPress={leave}
        />
      </View>
    </ScrollView>
  );
}

const layout = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  buttons: { gap: Spacing.sm },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
