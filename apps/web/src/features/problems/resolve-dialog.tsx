'use client';

import { useTranslation } from 'react-i18next';

import { WhoDidItDialog, workerChoices } from '@/components/who-did-it-dialog';

import { liveFixTask, type Problem } from './schema';
import { useWorkers } from './use-problems';

interface ResolveDialogProps {
  open: boolean;
  /** The task being closed; kept while the dialog fades out. */
  problem: Problem | null;
  /** The request is on its way. */
  isBusy: boolean;
  /** Who did the work; null: nobody, the manager did it alone. */
  onConfirm: (completedBy: string | null) => void;
  onClose: () => void;
}

/**
 * «Отметить выполненным?» with «Кто выполнил» (owner, 09.11): the technicians at work, the one
 * holding the repair first (even a cleaner it was given to), then those switched off. Naming
 * her finishes the work in her name; nobody hears of it.
 */
export function ResolveDialog({ open, problem, isBusy, onConfirm, onClose }: ResolveDialogProps) {
  const { t } = useTranslation();
  const workers = useWorkers();
  const live = problem === null ? null : liveFixTask(problem);
  const holder =
    live?.assignee_id == null
      ? null
      : { id: live.assignee_id, name: live.assignee?.full_name ?? null };

  return (
    <WhoDidItDialog
      open={open}
      words={{
        title: t('panel.problems.board.resolveTitle'),
        description: t('panel.problems.board.resolveText', { title: problem?.title ?? '' }),
        who: t('panel.problems.resolveDialog.who'),
        alone: t('panel.problems.resolveDialog.alone'),
        switchedOff: t('panel.problems.resolveDialog.switchedOff'),
        hint: t('panel.problems.resolveDialog.hint'),
        confirm: t('panel.problems.board.resolveConfirm'),
        abort: t('panel.problems.board.resolveAbort'),
      }}
      people={workerChoices(workers.data ?? [], holder, {
        unknown: t('panel.problems.unknownPerson'),
        holder: t('panel.problems.resolveDialog.holder'),
      })}
      isBusy={isBusy}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
