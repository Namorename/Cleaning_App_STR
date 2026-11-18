'use client';

import { BOARD_LIMITS, type BoardColumn } from '@str-ops/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { serverErrorText } from '@/lib/server-error';

import { useSaveCard } from './use-boards';

interface QuickAddProps {
  boardId: string;
  column: BoardColumn;
}

/**
 * The quickest way onto a board: the title, Enter, and the card stands in
 * this column. The field keeps its place for the next one. A card's id is
 * minted per title: a repeat after a lost answer is the same card.
 */
export function QuickAdd({ boardId, column }: QuickAddProps) {
  const { t } = useTranslation();
  const save = useSaveCard();
  const [title, setTitle] = useState('');
  const [cardId, setCardId] = useState(() => crypto.randomUUID());
  const failure = save.isError ? serverErrorText(save.error) : null;
  const columnName = t(`problems.statuses.${column}`);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const words = title.trim();
    if (words === '' || save.isPending) {
      return;
    }
    save.mutate(
      {
        cardId,
        boardId,
        column,
        fields: { title: words, description: '', dueOn: null, propertyId: null, color: null },
      },
      {
        onSuccess: () => {
          setTitle('');
          setCardId(crypto.randomUUID());
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <Input
        value={title}
        maxLength={BOARD_LIMITS.cardTitle}
        placeholder={t('boards.quickAdd')}
        aria-label={t('boards.quickAddLabel', { column: columnName })}
        aria-busy={save.isPending}
        onChange={(event) => setTitle(event.target.value)}
        className="h-11 bg-card"
      />
      {failure === null ? null : (
        <p role="alert" className="px-1 text-xs text-destructive">
          {failure.text}
        </p>
      )}
    </form>
  );
}
