'use client';

import { BOARD_LIMITS } from '@str-ops/shared';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { serverErrorText } from '@/lib/server-error';

import type { Board } from './schema';
import { useSaveBoard } from './use-boards';

interface BoardNameDialogProps {
  /** The board whose settings these are; absent, a new board is made under an id of its own. */
  board?: Pick<Board, 'id' | 'title' | 'shared'>;
  /**
   * The viewer is not the board's owner (an admin at another's board): «Видна только владельцу»
   * says who sees a private board, not «Видна только мне».
   */
  isOthersBoard?: boolean;
  onClose: () => void;
  /** The board is saved: the switcher opens a new one. */
  onSaved: (boardId: string) => void;
}

/** Who sees a board: its owner and the admins alone, or the other managers too. */
type Visibility = 'private' | 'shared';

/**
 * «Новая доска» and «Настройки доски» (20261126120000): the board's name, and who sees it — its
 * owner alone by default, or the other managers too; an admin sees every board. Mounted only while
 * open, so a new board's id is minted once per opening and a repeat is the same board.
 */
export function BoardNameDialog({
  board,
  isOthersBoard = false,
  onClose,
  onSaved,
}: BoardNameDialogProps) {
  const { t } = useTranslation();
  const save = useSaveBoard();
  const radioName = useId();
  const [boardId] = useState(() => board?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(board?.title ?? '');
  // Null until a choice is made: the board's visibility as it is now (a new board: its maker's).
  const [picked, setVisibility] = useState<Visibility | null>(null);
  const visibility: Visibility = picked ?? (board?.shared ? 'shared' : 'private');
  const failure = save.isError ? serverErrorText(save.error) : null;
  const isReady = title.trim() !== '';
  const choices: readonly { value: Visibility; label: string }[] = [
    {
      value: 'private',
      label: isOthersBoard ? t('boards.visibilityPrivateOwner') : t('boards.visibilityPrivate'),
    },
    { value: 'shared', label: t('boards.visibilityShared') },
  ];

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
    const shared = visibility === 'shared';
    // A new board says who sees it. A saved one says so only when the choice differs from what the
    // board is now: a rename alone never overwrites a visibility someone changed meanwhile.
    const isChange = board === undefined || (picked !== null && shared !== board.shared);
    save.mutate(
      { boardId, title, ...(isChange ? { shared } : {}) },
      { onSuccess: () => onSaved(boardId) },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {board === undefined ? t('boards.newBoard') : t('boards.settingsTitle')}
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
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('boards.visibility')}</legend>
            {choices.map((choice) => (
              <label key={choice.value} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={radioName}
                  value={choice.value}
                  className="size-4"
                  checked={visibility === choice.value}
                  onChange={() => setVisibility(choice.value)}
                />
                {choice.label}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">{t('boards.visibilityNote')}</p>
          </fieldset>
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
