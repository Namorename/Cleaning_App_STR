import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, type ButtonVariant } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FailureText } from '@/components/failure-text';
import { Spacing } from '@/constants/theme';
import { staffNames } from '@/features/board/format';
import { isClosed, liveHolder, type BoardProblem } from '@/features/board/schema';
import { useBoardProblem, useStaffDirectory } from '@/features/board/use-board';

import type { ProblemAction, ProblemActionKind } from './problem-api';
import { CancelProblemSheet, ResolveSheet, whoDidItChoices } from './problem-sheets';
import { useProblemAction } from './use-office';

/**
 * The manager's levers a task offers now, in the panel's order
 * (apps/web/src/features/problems/problem-actions.tsx): live — done, cancel,
 * the archive; closed — open again, the archive; archived — back from it only.
 */
export function officeProblemActions(problem: BoardProblem): readonly ProblemActionKind[] {
  if (problem.archived_at !== null) {
    return ['unarchive'];
  }
  if (isClosed(problem)) {
    return ['reopen', 'archive'];
  }
  return ['resolve', 'cancel', 'archive'];
}

const LEVER: Readonly<Record<ProblemActionKind, { label: string; variant: ButtonVariant }>> = {
  resolve: { label: 'office.problem.resolve', variant: 'primary' },
  reopen: { label: 'office.problem.reopen', variant: 'primary' },
  unarchive: { label: 'office.problem.unarchive', variant: 'primary' },
  cancel: { label: 'office.problem.cancel', variant: 'destructive' },
  archive: { label: 'office.problem.archive', variant: 'destructive' },
};

/** The levers asked about in a dialog of their own; the other two ask on a sheet. */
type Plain = 'reopen' | 'archive' | 'unarchive';

const QUESTION: Readonly<Record<Plain, { title: string; message?: string; confirm: string }>> = {
  reopen: {
    title: 'office.problem.reopenTitle',
    message: 'office.problem.reopenText',
    confirm: 'office.problem.reopenConfirm',
  },
  archive: {
    title: 'office.problem.archiveTitle',
    message: 'office.problem.archiveText',
    confirm: 'office.problem.archiveConfirm',
  },
  unarchive: { title: 'office.problem.unarchiveTitle', confirm: 'office.problem.unarchiveConfirm' },
};

function isPlain(kind: ProblemActionKind | null): kind is Plain {
  return kind === 'reopen' || kind === 'archive' || kind === 'unarchive';
}

interface OfficeProblemActionsProps {
  problemId: string;
}

/**
 * The office's part of a task's screen under the hand-out (owner, 2026-11-18):
 * close it as done naming who did it, cancel it, open it again, put it in the
 * archive or bring it back — each asked first, sent at once or not at all,
 * and offered only on what the screen read from the server since it opened.
 * A refusal is said where it was asked; the screen changes once the task is
 * read again.
 */
export function OfficeProblemActions({ problemId }: OfficeProblemActionsProps) {
  const { t } = useTranslation();
  const problem = useBoardProblem(problemId);
  const staff = useStaffDirectory();
  const action = useProblemAction();
  const [asked, setAsked] = useState<ProblemActionKind | null>(null);
  // The plain question stays on screen while it fades out, in its own words.
  const [question, setQuestion] = useState<Plain>('archive');
  const names = useMemo(() => staffNames(staff.data, t), [staff.data, t]);

  const task = problem.data ?? null;
  if (task === null) {
    return null;
  }

  const isCurrent = problem.isFetchedAfterMount && problem.error === null;
  const sending = action.isPending ? (action.variables?.kind ?? null) : null;

  const ask = (kind: ProblemActionKind) => {
    if (action.isPending) {
      return;
    }
    action.reset();
    if (isPlain(kind)) {
      setQuestion(kind);
    }
    setAsked(kind);
  };

  const send = (move: ProblemAction) => {
    if (action.isPending) {
      return;
    }
    action.mutate(move, { onSuccess: () => setAsked(null) });
  };

  const words = QUESTION[question];

  return (
    <View style={layout.section}>
      {action.error !== null && !(asked === 'resolve' || asked === 'cancel') ? (
        <FailureText error={action.error} />
      ) : null}
      {officeProblemActions(task).map((kind) => (
        <Button
          key={kind}
          variant={LEVER[kind].variant}
          label={t(LEVER[kind].label)}
          isBusy={sending === kind}
          isDisabled={!isCurrent || (sending !== null && sending !== kind)}
          onPress={() => ask(kind)}
        />
      ))}

      {asked === 'resolve' ? (
        <ResolveSheet
          title={task.title}
          people={whoDidItChoices(staff.data ?? [], liveHolder(task), names)}
          isBusy={action.isPending}
          error={action.error}
          onConfirm={(completedBy) => send({ kind: 'resolve', problemId, completedBy })}
          onClose={() => setAsked(null)}
        />
      ) : null}
      {asked === 'cancel' ? (
        <CancelProblemSheet
          isBusy={action.isPending}
          error={action.error}
          onConfirm={(reason) => send({ kind: 'cancel', problemId, reason })}
          onClose={() => setAsked(null)}
        />
      ) : null}
      <ConfirmDialog
        isVisible={isPlain(asked)}
        title={t(words.title)}
        message={words.message === undefined ? undefined : t(words.message)}
        confirmLabel={t(words.confirm)}
        cancelLabel={t('office.problem.keep')}
        variant={question === 'archive' ? 'destructive' : 'primary'}
        onConfirm={() => {
          setAsked(null);
          send({ kind: question, problemId });
        }}
        onCancel={() => setAsked(null)}
      />
    </View>
  );
}

/** Sizes only: the colours are the components'. */
const layout = StyleSheet.create({
  section: { gap: Spacing.md },
});
