'use client';

import { BOARD_COLUMNS, BOARD_LIMITS, type BoardColumn } from '@str-ops/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { serverErrorText } from '@/lib/server-error';

import { CardFieldsForm, EMPTY_FIELDS, fieldsOf, type FieldsDraft } from './card-fields';
import { useSaveCard } from './use-boards';

/** The steps typed one a line: the empty lines dropped, the first hundred kept. */
export function stepsFromLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, BOARD_LIMITS.steps);
}

interface NewCardDialogProps {
  boardId: string;
  onClose: () => void;
  /** The card is on the board: it opens. */
  onCreated: (cardId: string) => void;
}

/**
 * «Новая карточка» with everything a project starts with: the fields, the
 * column, and its steps — one a line — at once. Mounted only while it is open,
 * so every opening has an id of its own: a repeat after a lost answer is the
 * same card. While the write is on its way the form stays.
 */
export function NewCardDialog({ boardId, onClose, onCreated }: NewCardDialogProps) {
  const { t } = useTranslation();
  const save = useSaveCard();
  const [cardId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<FieldsDraft>(EMPTY_FIELDS);
  const [column, setColumn] = useState<BoardColumn>('open');
  const [stepsText, setStepsText] = useState('');
  const failure = save.isError ? serverErrorText(save.error) : null;
  const isReady = draft.title.trim() !== '';

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
    save.mutate(
      { cardId, boardId, column, fields: fieldsOf(draft), steps: stepsFromLines(stepsText) },
      { onSuccess: () => onCreated(cardId) },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('boards.newCard')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <CardFieldsForm draft={draft} onChange={setDraft} idPrefix="new-card" />
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-card-column">{t('boards.column')}</Label>
            <NativeSelect
              id="new-card-column"
              value={column}
              className="h-11 sm:max-w-xs"
              onChange={(event) => setColumn(event.target.value as BoardColumn)}
            >
              {BOARD_COLUMNS.map((option) => (
                <option key={option} value={option}>
                  {t(`problems.statuses.${option}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-card-steps">{t('boards.steps')}</Label>
            <Textarea
              id="new-card-steps"
              rows={4}
              value={stepsText}
              aria-describedby="new-card-steps-hint"
              onChange={(event) => setStepsText(event.target.value)}
            />
            <p id="new-card-steps-hint" className="text-xs text-muted-foreground">
              {t('boards.stepsHint')}
            </p>
          </div>
          {failure === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {failure.text}
              {failure.detail === null ? null : (
                <span className="block text-xs text-muted-foreground">{failure.detail}</span>
              )}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
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
              {t('boards.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
