'use client';

import { BOARD_LIMITS } from '@str-ops/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { serverErrorText } from '@/lib/server-error';

import { CardFieldsForm, EMPTY_FIELDS, fieldsOf, type FieldsDraft } from './card-fields';
import type { BoardLane } from './lanes';
import { assignablePeople } from './schema';
import { useOfficePeople, useSaveCard, useSetCardAssignee } from './use-boards';

/** The steps typed one a line: the empty lines dropped, the first hundred kept. */
export function stepsFromLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, BOARD_LIMITS.steps);
}

/** The select's value for «Без исполнителя». */
const NOBODY = 'none';

interface NewCardDialogProps {
  boardId: string;
  /** The board's owner: the new card's assignee unless another is picked (or nobody). */
  ownerId: string;
  /**
   * The board's live columns in order (20261126120000): the card goes to one, the first unless
   * another is picked.
   */
  columns: readonly BoardLane[];
  onClose: () => void;
  /** The card is on the board: it opens. */
  onCreated: (cardId: string) => void;
}

/**
 * «Новая карточка» with everything a project starts with: the fields, the
 * column, and its steps — one a line — at once. Mounted only while it is open,
 * so every opening has an id of its own: a repeat after a lost answer is the
 * same card. While the write is on its way the form stays. The assignee is the
 * board's owner unless another person — or nobody — is picked: the server makes
 * the card its owner's, and a different pick is a second write.
 */
export function NewCardDialog({
  boardId,
  ownerId,
  columns,
  onClose,
  onCreated,
}: NewCardDialogProps) {
  const { t } = useTranslation();
  const save = useSaveCard();
  const assign = useSetCardAssignee();
  const people = useOfficePeople();
  // Null until picked: the default, which is the owner when they can hold a card, else nobody —
  // what the server does by itself, so the default needs no second write.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const assignable = assignablePeople(people.data ?? []);
  const serverDefault = assignable.some((person) => person.id === ownerId) ? ownerId : NOBODY;
  const assigneeId = pickedId ?? serverDefault;
  const assignFailure = assign.isError ? serverErrorText(assign.error) : null;
  const [cardId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<FieldsDraft>(EMPTY_FIELDS);
  // Null until picked: the board's first column. A picked column deleted meanwhile is the first too.
  const [pickedColumnId, setPickedColumnId] = useState<string | null>(null);
  const columnId =
    columns.find((column) => column.key === pickedColumnId)?.key ?? columns[0]?.key ?? null;
  const [stepsText, setStepsText] = useState('');
  const failure = save.isError ? serverErrorText(save.error) : null;
  const isReady = draft.title.trim() !== '' && columnId !== null;

  const isBusy = save.isPending || assign.isPending;
  const close = () => {
    if (!isBusy) {
      onClose();
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isReady || isBusy || columnId === null) {
      return;
    }
    const picked = assigneeId === NOBODY ? null : assigneeId;
    // A repeat after a refusal is safe: the same id makes no second card, and the same assignee
    // again changes nothing.
    save.mutate(
      { cardId, boardId, columnId, fields: fieldsOf(draft), steps: stepsFromLines(stepsText) },
      {
        onSuccess: () => {
          if (assigneeId === serverDefault) {
            onCreated(cardId);
            return;
          }
          // Refused, the form stays with the reason: the card is made, its assignee not yet.
          assign.mutate({ cardId, assigneeId: picked }, { onSuccess: () => onCreated(cardId) });
        },
      },
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
              value={columnId ?? ''}
              className="h-11 sm:max-w-xs"
              onChange={(event) => setPickedColumnId(event.target.value)}
            >
              {columns.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-card-assignee">{t('boards.assignee')}</Label>
            <NativeSelect
              id="new-card-assignee"
              value={assigneeId}
              className="h-11 sm:max-w-xs"
              onChange={(event) => setPickedId(event.target.value)}
            >
              {assignable.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name ?? t('boards.unknownPerson')}
                </option>
              ))}
              <option value={NOBODY}>{t('boards.noAssignee')}</option>
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
          {assignFailure === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {assignFailure.text}
            </p>
          )}
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
              disabled={isBusy}
              onClick={close}
            >
              {t('boards.cancel')}
            </Button>
            <Button type="submit" className="h-11" disabled={isBusy || !isReady}>
              {t('boards.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
