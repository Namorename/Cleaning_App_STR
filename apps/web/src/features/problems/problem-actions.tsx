'use client';

import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { serverErrorText } from '@/lib/server-error';

import { isProblemArchived, isProblemClosed, type Problem } from './schema';
import {
  useArchiveProblem,
  useCancelProblem,
  useReopenProblem,
  useResolveProblem,
  useUnarchiveProblem,
} from './use-problems';

/** Which question, if any, is waiting for the manager's word. */
type PendingAction = 'cancel' | 'archive' | null;

/**
 * The manager's levers, in the page's header (5.4, variant A): one plain
 * action at hand, the dangerous ones apart.
 *
 * Live: «Отметить выполненным», and in the menu «⋯» «Отменить задание» and,
 * after a separator, «Удалить в архив». Closed: «Вернуть в работу», and the
 * archive in the menu. Archived: «Восстановить из архива» only — everything
 * else waits until the problem is back. Cancelling asks for a reason and
 * archiving for confirmation, each in a dialog of its own.
 */
export function ProblemActions({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  const resolve = useResolveProblem();
  const cancel = useCancelProblem();
  const reopen = useReopenProblem();
  const archive = useArchiveProblem();
  const unarchive = useUnarchiveProblem();
  const [pending, setPending] = useState<PendingAction>(null);

  const mutations = [resolve, cancel, reopen, archive, unarchive];
  const failed = mutations.find((mutation) => mutation.isError);
  const failure = failed === undefined ? null : serverErrorText(failed.error);
  const isBusy = mutations.some((mutation) => mutation.isPending);
  const isArchived = isProblemArchived(problem);
  const isClosed = isProblemClosed(problem);
  const close = () => setPending(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {isArchived ? (
          <Button
            type="button"
            className="h-11"
            disabled={isBusy}
            onClick={() => unarchive.mutate(problem.id)}
          >
            {t('panel.problems.actions.unarchive')}
          </Button>
        ) : isClosed ? (
          <Button
            type="button"
            className="h-11"
            disabled={isBusy}
            onClick={() => reopen.mutate(problem.id)}
          >
            {t('panel.problems.actions.reopen')}
          </Button>
        ) : (
          <Button
            type="button"
            className="h-11"
            disabled={isBusy}
            onClick={() => resolve.mutate(problem.id)}
          >
            {t('panel.problems.actions.resolve')}
          </Button>
        )}
        {isArchived ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="outline" className="size-11" />}
              aria-label={t('panel.problems.actions.more')}
              disabled={isBusy}
            >
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {isClosed ? null : (
                <>
                  <DropdownMenuItem variant="destructive" onClick={() => setPending('cancel')}>
                    {t('panel.problems.actions.cancel')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem variant="destructive" onClick={() => setPending('archive')}>
                {t('panel.problems.actions.archive')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail !== null ? (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          ) : null}
        </p>
      ) : null}

      {pending === 'cancel' ? (
        <CancelDialog
          isBusy={isBusy}
          onConfirm={(reason) =>
            cancel.mutate({ problemId: problem.id, reason }, { onSettled: close })
          }
          onClose={close}
        />
      ) : null}
      {pending === 'archive' ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t('panel.problems.actions.archive')}</DialogTitle>
              <DialogDescription>{t('panel.problems.actions.archiveText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11" onClick={close}>
                {t('panel.problems.actions.archiveAbort')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-11"
                disabled={isBusy}
                onClick={() => archive.mutate(problem.id, { onSettled: close })}
              >
                {t('panel.problems.actions.archiveConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

interface CancelDialogProps {
  isBusy: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** The reason is asked for before a problem is cancelled; a fresh dialog is a fresh draft. */
function CancelDialog({ isBusy, onConfirm, onClose }: CancelDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('panel.problems.actions.cancel')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cancelReason">{t('panel.problems.actions.cancelReason')}</Label>
          <Textarea
            id="cancelReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {t('panel.problems.actions.cancelAbort')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11"
            disabled={isBusy}
            onClick={() => onConfirm(reason)}
          >
            {t('panel.problems.actions.cancelConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
