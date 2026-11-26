'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { serverErrorText } from '@/lib/server-error';

import { assignablePeople, type Board, type BoardViewer } from './schema';
import { useOfficePeople, useTransferBoard } from './use-boards';

interface TransferDialogProps {
  board: Board;
  viewer: BoardViewer;
  onClose: () => void;
  /** Handed over: the new owner's name, for the line under the board. */
  onTransferred: (name: string) => void;
}

/**
 * «Передать доску» (20261126120000): its owner or an admin hands the board to another active
 * manager or admin of the company. What it means for the one handing it over is said first — an
 * admin keeps seeing it; an owner loses a private board, and the right to change a shared one —
 * and that cards, assignees and who sees the board stay. The new owner gets a push.
 */
export function TransferDialog({ board, viewer, onClose, onTransferred }: TransferDialogProps) {
  const { t } = useTranslation();
  const people = useOfficePeople();
  const transfer = useTransferBoard();
  const selectId = useId();
  const [toId, setToId] = useState('');
  const candidates = assignablePeople(people.data ?? []).filter(
    (person) => person.id !== board.owner_id,
  );
  const chosen = candidates.find((person) => person.id === toId);
  const isNobody = people.data !== undefined && candidates.length === 0;
  // The people were never read: nobody to choose from, and it is said why.
  const peopleFailure =
    people.data === undefined && people.isError ? serverErrorText(people.error) : null;
  const failure = transfer.isError ? serverErrorText(transfer.error) : null;
  const note = viewer.isAdmin
    ? t('boards.transferNoteAdmin')
    : board.shared
      ? t('boards.transferNoteShared')
      : t('boards.transferNotePrivate');

  const close = () => {
    if (!transfer.isPending) {
      onClose();
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (chosen === undefined || transfer.isPending) {
      return;
    }
    const name = chosen.full_name ?? t('boards.unknownPerson');
    transfer.mutate(
      { boardId: board.id, toId: chosen.id },
      { onSuccess: () => onTransferred(name) },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">
            {t('boards.transferTitle', { title: board.title })}
          </DialogTitle>
          <DialogDescription>{note}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {peopleFailure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {t('panel.team.loadError')}
              {peopleFailure.detail === null ? null : (
                <span className="block text-xs text-muted-foreground">{peopleFailure.detail}</span>
              )}
            </p>
          ) : isNobody ? (
            <p className="text-sm">{t('boards.transferNobody')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <Label htmlFor={selectId}>{t('boards.transferTo')}</Label>
              <NativeSelect
                id={selectId}
                required
                value={toId}
                className="h-11"
                onChange={(event) => setToId(event.target.value)}
              >
                <option value="" disabled>
                  {t('boards.transferPick')}
                </option>
                {candidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name ?? t('boards.unknownPerson')}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('boards.transferNoteCards')}</p>
          {failure === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {failure.text}
              {failure.detail === null ? null : (
                <span className="block text-xs text-muted-foreground">{failure.detail}</span>
              )}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={transfer.isPending}
              onClick={close}
            >
              {t('boards.cancel')}
            </Button>
            <Button
              type="submit"
              className="h-11"
              disabled={transfer.isPending || chosen === undefined}
            >
              {t('boards.transferConfirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
