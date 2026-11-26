'use client';

import { ADDITION_MAX_FILES } from '@str-ops/shared';
import { Check, ImagePlus, LoaderCircle, Play, X } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { serverErrorText } from '@/lib/server-error';
import { cn } from '@/lib/utils';

import type { OfficeFiles, OfficePick, PickNote } from './use-office-files';

/** What the file dialog offers: any picture (redrawn as a JPEG) and the two video types sent. */
const ACCEPT = 'image/*,video/mp4,video/quicktime';

interface OfficeFilesPickerProps {
  files: OfficeFiles;
  /** Nothing may change: the form is sending, or has sent. */
  isLocked: boolean;
  /** The id of the label that names the picker, for the screen reader. */
  labelledBy?: string;
}

/**
 * The office's files for a task (20261126100000): the button that opens the file dialog, and a
 * tile for each file picked — its thumbnail (a photo) or its length (a video), where it is on its
 * way, and the reason it failed, kept on the tile until it is tried again or taken out.
 */
export function OfficeFilesPicker({ files, isLocked, labelledBy }: OfficeFilesPickerProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const isFull = files.picks.length >= ADDITION_MAX_FILES;

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={labelledBy}>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        data-testid="office-files-input"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          // The same file may be picked again after it was taken out.
          event.target.value = '';
          if (picked.length > 0) {
            void files.add(picked);
          }
        }}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={isLocked || isFull || files.isPreparing}
          onClick={() => input.current?.click()}
        >
          {files.isPreparing ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <ImagePlus aria-hidden="true" />
          )}
          {t('problems.additions.choose')}
        </Button>
      </div>
      {files.picks.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2" aria-label={t('problems.additions.files')}>
          {files.picks.map((pick) => (
            <PickTile
              key={pick.id}
              pick={pick}
              canRemove={!isLocked && pick.status !== 'uploading' && pick.status !== 'done'}
              onRemove={() => files.remove(pick.id)}
            />
          ))}
        </ul>
      )}
      {files.picks
        .filter((pick) => pick.status === 'failed')
        .map((pick) => (
          <ServerFailure
            key={pick.id}
            error={pick.error}
            lead={t('problems.additions.failed', { name: pick.name })}
          />
        ))}
      {files.notes.map((note, index) => (
        <p key={`${note.name}-${index}`} role="status" className="text-sm text-destructive">
          {noteText(note, t)}
        </p>
      ))}
    </div>
  );
}

interface ServerFailureProps {
  error: unknown;
  /** What failed, said before the reason. */
  lead?: string;
}

/** A refusal in the reader's words; an unknown one keeps the server's own words in small print. */
export function ServerFailure({ error, lead }: ServerFailureProps) {
  const failure = serverErrorText(error);
  return (
    <p role="alert" className="text-sm text-destructive">
      {lead === undefined ? failure.text : `${lead} — ${failure.text}`}
      {failure.detail === null ? null : (
        <span className="block text-xs text-muted-foreground">{failure.detail}</span>
      )}
    </p>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Why a file was not taken, in the screen's words. */
function noteText(note: PickNote, t: Translate): string {
  const { refusal } = note;
  switch (refusal.key) {
    case 'tooMany':
      return t('problems.additions.tooMany', { count: refusal.count });
    case 'tooLarge':
      return t('problems.additions.tooLarge', { name: note.name, limit: refusal.limit });
    case 'videoTooLong':
      return t('problems.additions.videoTooLong', { name: note.name, limit: refusal.limit });
    case 'videoUnreadable':
      return t('problems.additions.videoUnreadable', { name: note.name });
    case 'notMedia':
      return t('problems.additions.notMedia', { name: note.name });
  }
}

interface PickTileProps {
  pick: OfficePick;
  canRemove: boolean;
  onRemove: () => void;
}

/** One picked file: what it is, and where it is. */
function PickTile({ pick, canRemove, onRemove }: PickTileProps) {
  const { t } = useTranslation();
  const kindWord =
    pick.kind === 'video' ? t('problems.additions.fileVideo') : t('problems.additions.filePhoto');
  return (
    <li
      className={cn(
        'relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted',
        pick.status === 'failed' && 'border-destructive ring-2 ring-destructive/40',
      )}
      aria-label={`${kindWord}: ${pick.name}`}
      data-status={pick.status}
    >
      {pick.previewUrl === null ? (
        <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <Play aria-hidden="true" className="size-5" />
          {pick.durationSec === null ? null : `${Math.round(pick.durationSec)} s`}
        </span>
      ) : (
        // A blob: link of a file not sent yet: next/image has nothing to optimise here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pick.previewUrl} alt="" className="size-full object-cover" />
      )}
      {pick.status === 'uploading' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-background/60">
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
        </span>
      ) : null}
      {pick.status === 'done' ? (
        <span className="absolute right-1 bottom-1 rounded-full bg-primary p-0.5 text-primary-foreground">
          <Check aria-hidden="true" className="size-3" />
        </span>
      ) : null}
      {canRemove ? (
        <button
          type="button"
          className="absolute top-1 right-1 rounded-full bg-background/90 p-1 shadow focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={t('problems.additions.remove', { name: pick.name })}
          onClick={onRemove}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}
