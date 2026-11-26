'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ALONE, WhoDidItField, workerChoices } from '@/components/who-did-it-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { ClosingAddition } from './api';
import { OfficeFilesPicker } from './office-files-picker';
import { liveFixTask, type Problem } from './schema';
import { useOfficeFiles } from './use-office-files';
import { useWorkers } from './use-problems';

/** The longest comment: a message of the task's chat (chat_body_max_length). */
const COMMENT_MAX_LENGTH = 4000;

/** The dialog stands from the top: the files' tiles grow it downwards. */
const DIALOG_CLASS =
  'top-4 max-h-[calc(100dvh-2rem)] translate-y-0 overflow-y-auto sm:top-[8vh] sm:max-h-[84dvh] sm:max-w-lg';

/** What the manager decided: who did the work, and what goes with the closing. */
export interface ResolveChoice {
  /** Who did the work; null: nobody, the manager did it alone. */
  completedBy: string | null;
  /** The comment and the files' batch; null: nothing added — the closing of before. */
  closing: ClosingAddition | null;
}

interface ResolveDialogProps {
  open: boolean;
  /** The task being closed; kept while the dialog fades out. */
  problem: Problem | null;
  /** The request is on its way. */
  isBusy: boolean;
  onConfirm: (choice: ResolveChoice) => void;
  onClose: () => void;
}

/**
 * «Отметить выполненным?» with «Кто выполнил» (owner, 09.11) and, since 26.11, a comment and
 * photos or videos, both optional. Nothing added: one press closes, as it always did. Something
 * added: the files go first, then the closing takes them and the comment in one transaction —
 * a file that failed keeps the dialog open with the reason, to try again or to close without it.
 */
export function ResolveDialog({ open, problem, isBusy, onConfirm, onClose }: ResolveDialogProps) {
  const { t } = useTranslation();
  const workers = useWorkers();
  const files = useOfficeFiles(problem?.id ?? '');
  const [choice, setChoice] = useState(ALONE);
  const [comment, setComment] = useState('');
  const [commentId, setCommentId] = useState(() => crypto.randomUUID());
  const [isSent, setIsSent] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChoice(ALONE);
      setComment('');
      setCommentId(crypto.randomUUID());
      setIsSent(false);
      files.reset();
    }
  }

  const live = problem === null ? null : liveFixTask(problem);
  const holder =
    live?.assignee_id == null
      ? null
      : { id: live.assignee_id, name: live.assignee?.full_name ?? null };
  const completedBy = choice === ALONE ? null : choice;
  const words = comment.trim();
  const isWorking = isBusy || files.isUploading;
  const hasFailed = files.failedCount > 0 && !files.isUploading;

  /** Close with the files that arrived and the words, if any. */
  const finish = (arrived: number) => {
    setIsSent(true);
    onConfirm({
      completedBy,
      closing:
        arrived === 0 && words === ''
          ? null
          : { additionId: files.additionId, comment: words === '' ? null : words, commentId },
    });
  };

  const confirm = async () => {
    setIsSent(true);
    if (files.picks.length === 0) {
      finish(0);
      return;
    }
    const outcome = await files.upload();
    if (outcome.failed > 0) {
      setIsSent(false);
      return;
    }
    finish(outcome.done);
  };

  const close = () => {
    if (!isWorking) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{t('panel.problems.board.resolveTitle')}</DialogTitle>
          <DialogDescription>
            {t('panel.problems.board.resolveText', { title: problem?.title ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <WhoDidItField
          words={{
            who: t('panel.problems.resolveDialog.who'),
            alone: t('panel.problems.resolveDialog.alone'),
            switchedOff: t('panel.problems.resolveDialog.switchedOff'),
            hint: t('panel.problems.resolveDialog.hint'),
          }}
          people={workerChoices(workers.data ?? [], holder, {
            unknown: t('panel.problems.unknownPerson'),
            holder: t('panel.problems.resolveDialog.holder'),
          })}
          choice={choice}
          onChoice={setChoice}
          isDisabled={isWorking || isSent}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="closing-comment">{t('problems.additions.comment')}</Label>
          <Textarea
            id="closing-comment"
            value={comment}
            maxLength={COMMENT_MAX_LENGTH}
            disabled={isWorking || isSent}
            onChange={(event) => setComment(event.target.value)}
            aria-describedby="closing-comment-hint"
            rows={3}
          />
          <p id="closing-comment-hint" className="text-sm text-muted-foreground">
            {t('problems.additions.commentHint')}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="closing-files-label" className="text-sm font-medium">
            {t('problems.additions.files')}
          </span>
          <OfficeFilesPicker
            files={files}
            isLocked={isWorking || isSent}
            labelledBy="closing-files-label"
          />
        </div>
        {files.isUploading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('problems.additions.sending', {
              done: files.doneCount,
              total: files.picks.length,
            })}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={isWorking}
            onClick={close}
          >
            {t('panel.problems.board.resolveAbort')}
          </Button>
          {hasFailed ? (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={isWorking || isSent}
              onClick={() => finish(files.doneCount)}
            >
              {t('problems.additions.closeWithout')}
            </Button>
          ) : null}
          <Button
            type="button"
            className="h-11"
            disabled={isWorking || isSent || files.isPreparing}
            onClick={() => void confirm()}
          >
            {hasFailed ? t('problems.additions.retry') : t('panel.problems.board.resolveConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
