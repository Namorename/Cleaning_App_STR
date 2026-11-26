'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { serverErrorText } from '@/lib/server-error';

import { ConfirmMoveDialog } from './board-dialogs';
import type { Problem } from './schema';
import { useDeleteArchivedProblem } from './use-problems';

interface ProblemPurgeProps {
  problem: Pick<Problem, 'id' | 'title'>;
  /** The small button of a list row, rather than the page header's. */
  isCompact?: boolean;
  /** After the task is gone: a page that showed it leaves. */
  onDeleted?: () => void;
}

/**
 * «Удалить навсегда» of an archived task (an admin's, 20261126150000): it asks first, saying the
 * task goes with its repairs, files, conversation and journal and that it cannot be undone, then
 * deletes. The caller shows it to an admin on an archived task alone; the server refuses anybody
 * and anything else either way.
 */
export function ProblemPurge({ problem, isCompact = false, onDeleted }: ProblemPurgeProps) {
  const { t } = useTranslation();
  const purge = useDeleteArchivedProblem();
  const [isAsking, setIsAsking] = useState(false);
  const failure = purge.isError ? serverErrorText(purge.error) : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="destructive"
        size={isCompact ? 'sm' : 'default'}
        className={isCompact ? undefined : 'h-11'}
        disabled={purge.isPending}
        onClick={() => {
          purge.reset();
          setIsAsking(true);
        }}
      >
        {t('panel.problems.actions.purge')}
      </Button>
      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail !== null ? (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          ) : null}
        </p>
      ) : null}
      <ConfirmMoveDialog
        open={isAsking}
        title={t('panel.problems.actions.purgeTitle')}
        description={t('panel.problems.actions.purgeText', { title: problem.title })}
        confirmLabel={t('panel.problems.actions.purgeConfirm')}
        abortLabel={t('panel.problems.actions.purgeAbort')}
        isDestructive
        isBusy={purge.isPending}
        onConfirm={() =>
          purge.mutate(problem.id, {
            onSuccess: () => onDeleted?.(),
            onSettled: () => setIsAsking(false),
          })
        }
        onClose={() => setIsAsking(false)}
      />
    </div>
  );
}
