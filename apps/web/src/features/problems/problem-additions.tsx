'use client';

import { ADDITION_MAX_FILES } from '@str-ops/shared';
import { ImagePlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DetailSection } from '@/components/detail-section';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MediaGallery } from '@/features/media/media-gallery';
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import type { Addition } from './additions-api';
import { OfficeFilesPicker, ServerFailure } from './office-files-picker';
import { useAdditions, usePublishOfficeFiles } from './use-problems';
import { useOfficeFiles } from './use-office-files';

/** The dialog stands from the top: its list of tiles grows downwards as files are picked. */
const DIALOG_CLASS =
  'top-4 max-h-[calc(100dvh-2rem)] translate-y-0 overflow-y-auto sm:top-[8vh] sm:max-h-[84dvh] sm:max-w-lg';

/**
 * The batch of the task's current closing: the last one sent with a closing, while the task is
 * closed. The closing block shows it beside «Кто выполнил»; every other batch is in the list.
 */
export function currentClosingAddition(
  additions: readonly Addition[],
  isClosed: boolean,
): Addition | null {
  if (!isClosed) {
    return null;
  }
  const closings = additions.filter((addition) => addition.stage === 'closing');
  return closings.at(-1) ?? null;
}

interface AdditionByProps {
  addition: Addition;
}

/** «Пётр, 26 нояб. 2026, 14:05»: who sent the batch and when. */
function AdditionBy({ addition }: AdditionByProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  return (
    <p className="text-xs text-muted-foreground">
      {t('problems.additions.by', {
        name: addition.authorName ?? t('panel.problems.unknownPerson'),
        when: formatDateTime(addition.publishedAt, language),
      })}
    </p>
  );
}

interface OfficeAdditionsSectionProps {
  problemId: string;
  /** The task is open: the office may add to it. */
  canAdd: boolean;
  /** The task is closed: its current closing's batch is the closing block's. */
  isClosed: boolean;
}

/**
 * «Добавлено менеджером» (owner, 2026-11-26): the photos and videos the office added to the task,
 * batch by batch — who and when over each — and «Добавить фото или видео» while the task is open.
 * Nothing at all on a closed task the office added nothing to.
 */
export function OfficeAdditionsSection({ problemId, canAdd, isClosed }: OfficeAdditionsSectionProps) {
  const { t } = useTranslation();
  const additions = useAdditions(problemId);
  const [isAdding, setAdding] = useState(false);

  const closing = currentClosingAddition(additions.data ?? [], isClosed);
  const listed = (additions.data ?? []).filter(
    (addition) => addition !== closing && addition.files.length > 0,
  );
  if (!canAdd && listed.length === 0 && !additions.isError) {
    return null;
  }

  return (
    <DetailSection title={t('problems.additions.title')}>
      {additions.isPending ? (
        <LoadingState>{t('panel.problems.loading')}</LoadingState>
      ) : additions.isError ? (
        <ErrorState message={t('panel.problems.loadError')} error={additions.error} />
      ) : listed.length === 0 ? (
        <p className="text-muted-foreground">{t('problems.additions.noneYet')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {listed.map((addition) => (
            <div key={addition.id} className="flex flex-col gap-1.5">
              <AdditionBy addition={addition} />
              {addition.stage === 'closing' ? (
                <p className="text-xs font-medium">{t('problems.additions.atClosing')}</p>
              ) : null}
              <MediaGallery files={addition.files} title={t('problems.additions.title')} />
            </div>
          ))}
        </div>
      )}
      {canAdd ? (
        <div className="mt-3">
          <Button type="button" variant="outline" className="h-11" onClick={() => setAdding(true)}>
            <ImagePlus aria-hidden="true" />
            {t('problems.additions.add')}
          </Button>
        </div>
      ) : null}
      {isAdding ? <AddFilesDialog problemId={problemId} onClose={() => setAdding(false)} /> : null}
    </DetailSection>
  );
}

interface AddFilesDialogProps {
  problemId: string;
  onClose: () => void;
}

/**
 * «Фото и видео к заданию»: pick, send, and the batch shows on the task. A file that fails stays
 * on its tile with the reason; the manager tries again or adds the others without it.
 */
function AddFilesDialog({ problemId, onClose }: AddFilesDialogProps) {
  const { t } = useTranslation();
  const files = useOfficeFiles(problemId);
  const publish = usePublishOfficeFiles(problemId);
  const isBusy = files.isUploading || publish.isPending;
  const hasFailed = files.failedCount > 0 && !files.isUploading;
  const labelId = 'office-files-label';

  const finish = () =>
    publish.mutate(files.additionId, {
      onSuccess: () => {
        files.reset();
        onClose();
      },
    });

  const send = async () => {
    const outcome = await files.upload();
    if (outcome.failed === 0) {
      finish();
    }
  };

  const close = () => {
    if (!isBusy) {
      files.reset();
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{t('problems.additions.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('problems.additions.dialogText', { limit: ADDITION_MAX_FILES })}
          </DialogDescription>
        </DialogHeader>
        <span id={labelId} className="sr-only">
          {t('problems.additions.files')}
        </span>
        <OfficeFilesPicker files={files} isLocked={isBusy} labelledBy={labelId} />
        {files.isUploading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('problems.additions.sending', {
              done: files.doneCount,
              total: files.picks.length,
            })}
          </p>
        ) : null}
        {publish.isError ? (
          <ServerFailure error={publish.error} />
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" disabled={isBusy} onClick={close}>
            {t('problems.additions.cancel')}
          </Button>
          {hasFailed && files.doneCount > 0 ? (
            <Button type="button" variant="outline" className="h-11" disabled={isBusy} onClick={finish}>
              {t('problems.additions.addWithout')}
            </Button>
          ) : null}
          <Button
            type="button"
            className="h-11"
            disabled={isBusy || files.isPreparing || files.picks.length === 0}
            onClick={() => void send()}
          >
            {hasFailed ? t('problems.additions.retry') : t('problems.additions.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ClosingAdditionProps {
  problemId: string;
  /** Resolved or cancelled: an archived task still open has no closing to show. */
  isClosed: boolean;
}

/**
 * What the manager sent with the closing, beside «Кто выполнил / закрыл»: the comment (its words
 * live in the task's chat) and the files. Nothing when the closing brought neither.
 */
export function ClosingAddition({ problemId, isClosed }: ClosingAdditionProps) {
  const { t } = useTranslation();
  const additions = useAdditions(problemId);
  const closing = currentClosingAddition(additions.data ?? [], isClosed);
  if (closing === null) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="closing-addition">
      <p className="text-xs font-medium">{t('problems.additions.atClosing')}</p>
      <AdditionBy addition={closing} />
      {closing.comment === null ? null : (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {t('problems.additions.closingComment')}
          </span>
          <p className="rounded-lg bg-muted/60 px-3 py-2 break-words whitespace-pre-wrap">
            {closing.comment}
          </p>
        </div>
      )}
      {closing.files.length === 0 ? null : (
        <MediaGallery files={closing.files} title={t('problems.additions.atClosing')} />
      )}
    </div>
  );
}
