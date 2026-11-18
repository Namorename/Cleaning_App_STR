'use client';

import { BOARD_LIMITS } from '@str-ops/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { serverErrorText } from '@/lib/server-error';

import { useSaveBoard } from './use-boards';

interface BoardNameDialogProps {
  /** The board to rename; absent, a new board is made under an id of its own. */
  board?: { id: string; title: string };
  onClose: () => void;
  /** The board is saved: the switcher opens a new one. */
  onSaved: (boardId: string) => void;
}

/**
 * «Новая доска» and «Переименовать»: one field, the board's name. Mounted only
 * while open, so a new board's id is minted once per opening and a repeat is
 * the same board.
 */
export function BoardNameDialog({ board, onClose, onSaved }: BoardNameDialogProps) {
  const { t } = useTranslation();
  const save = useSaveBoard();
  const [boardId] = useState(() => board?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(board?.title ?? '');
  const failure = save.isError ? serverErrorText(save.error) : null;
  const isReady = title.trim() !== '';

  const close = () => {
    if (!save.isPending) {
      onClose();
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isReady || save.isPending) {
      return;
    }
    save.mutate({ boardId, title }, { onSuccess: () => onSaved(boardId) });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {board === undefined ? t('boards.newBoard') : t('boards.renameTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="board-name">{t('boards.boardName')}</Label>
            <Input
              id="board-name"
              autoFocus
              value={title}
              maxLength={BOARD_LIMITS.boardTitle}
              placeholder={t('boards.boardNamePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('boards.boardRightsNote')}</p>
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
              disabled={save.isPending}
              onClick={close}
            >
              {t('boards.cancel')}
            </Button>
            <Button type="submit" className="h-11" disabled={save.isPending || !isReady}>
              {board === undefined ? t('boards.create') : t('boards.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
